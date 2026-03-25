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

    // Pornolab categories (optional: 1=Video, 2=Images, 3=Games, etc.)
    const categories = ["0"]; // "0" = all categories
    let htmlPages = [];

    try {
      htmlPages = await Promise.all(
        categories.map(cat =>
          fetch(`https://pornolab.net/forum/search.php?st=0&sr=topics&sf=titleonly&sk=t&sd=d&start=0&search=${encodeURIComponent(query)}&c[]=${cat}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text())
        )
      );
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const seen = new Set(); // Avoid duplicates

    for (const html of htmlPages) {
      // Parse rows with torrents (Pornolab uses tables with class "topics")
      const rowRegex = /<tr class="[^"]*">([\s\S]*?)<\/tr>/g;
      let row;

      while ((row = rowRegex.exec(html)) !== null) {
        const block = row[1];

        // Extract title and torrent ID
        const titleMatch = block.match(/<a href="\/forum\/viewtopic\.php\?t=(\d+)"[^>]*>(.*?)<\/a>/);
        if (!titleMatch) continue;

        const id = titleMatch[1];
        const title = titleMatch[2].trim();

        if (seen.has(id)) continue;
        seen.add(id);

        // Extract magnet link (Pornolab uses "magnet:?" links)
        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        // Extract size (e.g., "1.2 GB")
        const sizeMatch = block.match(/(\d+[\.,]?\d*)\s*(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Extract seeders/peers (Pornolab shows them in <td> tags)
        const seedMatch = block.match(/<td[^>]*>(\d+)<\/td>/g);
        const seeders = seedMatch && seedMatch.length >= 3 ? parseInt(seedMatch[2].replace(/<[^>]+>/g, "")) : 0;
        const peers = seedMatch && seedMatch.length >= 4 ? parseInt(seedMatch[3].replace(/<[^>]+>/g, "")) : 0;

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "Pornolab",
          MagnetUri:   hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
            : magnet,
          Link:        `https://pornolab.net/forum/viewtopic.php?t=${id}`,
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
