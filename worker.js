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

    // XXXTor categories (optional, adjust as needed)
    const categories = [];
    let htmlPages = [];

    try {
      // XXXTor search URL format
      htmlPages = await Promise.all(
        categories.length > 0
          ? categories.map(cat =>
              fetch(`https://xxxtor.com/search/${encodeURIComponent(query)}/${cat}`, {
                headers: { "User-Agent": "Mozilla/5.0" }
              }).then(r => r.text())
            )
          : [fetch(`https://xxxtor.com/search/${encodeURIComponent(query)}`, {
              headers: { "User-Agent": "Mozilla/5.0" }
            }).then(r => r.text())]
      );
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const seen = new Set(); // Avoid duplicates

    for (const html of htmlPages) {
      // Parse rows with torrents (XXXTor uses <div class="torrent-item">)
      const rowRegex = /<div class="torrent-item">([\s\S]*?)<\/div>/g;
      let row;

      while ((row = rowRegex.exec(html)) !== null) {
        const block = row[1];

        // Extract title and torrent ID
        const titleMatch = block.match(/href="\/torrent\/(\d+)\/([^"]+)"/);
        if (!titleMatch) continue;

        const id = titleMatch[1];
        const title = decodeURIComponent(titleMatch[2].replace(/-/g, ' ')).trim();

        if (seen.has(id)) continue;
        seen.add(id);

        // Extract magnet link (XXXTor uses direct magnet links)
        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        // Extract size (e.g., "1.2 GB")
        const sizeMatch = block.match(/(\d+[\.,]?\d*)\s*(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Extract seeders/peers (XXXTor shows them in <span> tags)
        const seedMatch = block.match(/<span class="seeders">(\d+)<\/span>/);
        const peerMatch = block.match(/<span class="leechers">(\d+)<\/span>/);
        const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "XXXTor",
          MagnetUri:   hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
            : magnet,
          Link:        `https://xxxtor.com/torrent/${id}/${encodeURIComponent(title.replace(/\s+/g, '-'))}`,
          PublishDate: new Date().toISOString(),
        });
      }
    }

    // Sort by seeders (most popular first)
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ Results, Indexers: [] });
  }
};

// Helper: Convert size to bytes
function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  switch (unit.toUpperCase()) {
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

// Helper: JSON response with CORS
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
