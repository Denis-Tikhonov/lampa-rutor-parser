export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Handle OPTIONS for CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    // Get search query
    const query = url.searchParams.get("query") || url.searchParams.get("Query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    // Fetch search results from leporno.de
    let html;
    try {
      html = await fetch(
        `https://leporno.de/search.php?sid=703147bc083119c1c19157118930bfdd&q=${encodeURIComponent(query)}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
          }
        }
      ).then(r => r.text());
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    // Parse results
    const results = [];
    const rowRegex = /<div class="torrent-row">([\s\S]*?)<\/div>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];

      // Extract title and link
      const titleMatch = row.match(/<a href="\/torrent\/(\d+)\/.*?" class="torrent-title">(.*?)<\/a>/i);
      if (!titleMatch) continue;

      const id = titleMatch[1];
      const title = titleMatch[2].trim();

      // Extract magnet link
      const magnetMatch = row.match(/<a href="(magnet:\?.*?)"/i);
      const magnet = magnetMatch ? magnetMatch[1] : "";
      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";
      if (!hash) continue;

      // Extract size
      const sizeMatch = row.match(/<span class="torrent-size">(.*?)<\/span>/i);
      const size = sizeMatch ? parseSizeToBytes(sizeMatch[1]) : 0;

      // Extract seeders and leechers
      const seedMatch = row.match(/<span class="seeders">(\d+)<\/span>/i);
      const leechMatch = row.match(/<span class="leechers">(\d+)<\/span>/i);
      const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
      const leechers = leechMatch ? parseInt(leechMatch[1]) : 0;

      // Add to results
      results.push({
        Title: title,
        Seeders: seeders,
        Peers: leechers,
        Size: size,
        MagnetUri: magnet,
        Link: `https://leporno.de/torrent/${id}`,
        Tracker: "Leporno",
        PublishDate: new Date().toISOString(),
      });
    }

    // Sort by seeders (descending)
    results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ Results: results, Indexers: [] });
  }
};

// Helper function to parse size (e.g., "1.2 GB" -> bytes)
function parseSizeToBytes(sizeStr) {
  const [num, unit] = sizeStr.split(" ");
  const value = parseFloat(num.replace(",", "."));

  switch (unit?.toUpperCase()) {
    case "GB": return Math.round(value * 1024 ** 3);
    case "MB": return Math.round(value * 1024 ** 2);
    case "KB": return Math.round(value * 1024);
    default: return 0;
  }
}

// Helper function for JSON response
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
