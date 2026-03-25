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
      // Corrected XXXTor search URL
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

      // Main parsing function
      const parseTorrentBlock = (block) => {
        // Extract torrent ID and title
        const torrentLinkMatch = block.match(/href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)(?:\/|&[^"']*)?([^"']*)?["']/i);
        if (!torrentLinkMatch) return null;

        const id = torrentLinkMatch[1];
        if (seen.has(id)) return null;
        seen.add(id);

        let slug = torrentLinkMatch[2] || "";
        slug = slug.replace(/[?&].*$/, '').trim();
        const title = slug ? decodeURIComponent(slug.replace(/-/g, ' ')).trim() : `Torrent ${id}`;

        // Extract magnet link or enclosure
        let magnet = "";
        let hash = "";

        // Try to find magnet link
        const magnetMatch = block.match(/href=["'](magnet:\?[^"']+)["']/i);
        if (magnetMatch) {
          magnet = magnetMatch[1];
          const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
          if (hashMatch) hash = hashMatch[1].toLowerCase();
        }

        // Try to find enclosure (RSS-style)
        const enclosureMatch = block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
        if (enclosureMatch && !magnet) {
          const enclosureUrl = enclosureMatch[1];
          if (enclosureUrl.startsWith('magnet:')) {
            magnet = enclosureUrl;
            const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
            if (hashMatch) hash = hashMatch[1].toLowerCase();
          }
        }

        // Extract size
        const sizeMatch = block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Extract seeders and peers
        const seedMatch = block.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i);
        const peerMatch = block.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i);
        const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

        // Extract date
        const dateMatch = block.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
        const publishDate = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString();

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
          Enclosure: enclosureMatch ? enclosureMatch[1] : null // Add enclosure URL if found
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
          if (row.includes('<th')) continue; // Skip header row

          const result = parseTorrentBlock(row);
          if (result) Results.push(result);
        }
      }

      // Sort by seeders (descending)
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

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(/,/g, '.'));
  const u = unit.toUpperCase().replace('IB', 'B');
  switch (u) {
    case "TB": return Math.round(n * 1024 ** 4);
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

function parseDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {}
  return new Date().toISOString();
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
