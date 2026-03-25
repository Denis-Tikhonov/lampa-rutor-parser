export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS support
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    const query = url.searchParams.get("Query") || url.searchParams.get("query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    try {
      const searchUrl = `https://xxxtor.com/b.php?search=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": "https://xxxtor.com/",
          "Connection": "keep-alive",
        }
      });

      if (!response.ok) {
        return jsonResponse({ Results: [], Indexers: [], error: `HTTP ${response.status}` });
      }

      const html = await response.text();
      const Results = [];
      const seen = new Set();

      const parseTorrentBlock = (block) => {
        const torrentLinkMatch = block.match(/href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)(?:\/|&[^"']*)?([^"']*)?["']/i);
        if (!torrentLinkMatch) return null;

        const id = torrentLinkMatch[1];
        if (seen.has(id)) return null;
        seen.add(id);

        let slug = torrentLinkMatch[2] || "";
        slug = slug.replace(/[?&].*$/, '').trim();
        const title = slug ? decodeURIComponent(slug.replace(/-/g, ' ')).trim() : `Torrent ${id}`;

        // Extract magnet link and hash
        const magnetMatch = block.match(/href=["'](magnet:\?[^"']+)["']/i);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash = magnet ? (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] : "";

        // Extract size
        const sizeMatch = block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Extract seeders and peers
        const seedMatch = block.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i);
        const peerMatch = block.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i);
        const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

        // Extract uploader (раздающий)
        const uploaderMatch = block.match(/class=["'][^"']*uploader[^"']*["'][^>]*>([^<]+)/i)
                          || block.match(/uploaded by[:\s]*<[^>]+>([^<]+)/i)
                          || block.match(/by[:\s]*<[^>]+>([^<]+)/i);
        const uploader = uploaderMatch ? uploaderMatch[1].trim() : "Unknown";

        // Extract date
        const dateMatch = block.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
        const publishDate = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString();

        // Extract bitrate (если указано в разметке)
        const bitrateMatch = block.match(/(1080p|720p|480p|2160p|UHD|HD|SD|4K|8K)/i)
                          || block.match(/(\d{3,4})[kK]bps/i)
                          || block.match(/bitrate[:\s]*(\d+)[^<]*[kK]bps/i);
        const bitrate = bitrateMatch ? bitrateMatch[1].toUpperCase() : "Unknown";

        return {
          Title: title,
          Seeders: seeders,
          Peers: peers,
          Size: size,
          Tracker: "XXXTor",
          MagnetUri: hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
            : magnet,
          Link: `https://xxxtor.com/torrent/${id}/${slug || title.replace(/\s+/g, '-')}`,
          PublishDate: publishDate,
          Uploader: uploader,
          Bitrate: bitrate,
        };
      };

      // Try parsing torrent blocks first
      const torrentBlockRegex = /<div class=["']torrent-item["'][^>]*>([\s\S]*?)<\/div>/gi;
      let blockMatch;
      while ((blockMatch = torrentBlockRegex.exec(html)) !== null) {
        const result = parseTorrentBlock(blockMatch[1]);
        if (result) Results.push(result);
      }

      // Fallback to table rows if no results found
      if (Results.length === 0) {
        const tableRowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = tableRowRegex.exec(html)) !== null) {
          const row = rowMatch[1];
          if (row.includes('<th')) continue;

          const result = parseTorrentBlock(row);
          if (result) Results.push(result);
        }
      }

      Results.sort((a, b) => b.Seeders - a.Seeders);

      return jsonResponse({
        Results,
        Indexers: ["XXXTor"],
        meta: {
          query: query,
          found: Results.length,
          timestamp: new Date().toISOString()
        }
      });

    } catch (e) {
      return jsonResponse({
        Results: [],
        Indexers: [],
        error: e.message,
        stack: e.stack
      });
    }
  }
};

// вспомогательные функции (parseSizeToBytes, parseDate, jsonResponse) остаются без изменений
