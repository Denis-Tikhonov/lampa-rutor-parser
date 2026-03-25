export default {
  async fetch(request) {
    const url = new URL(request.url);
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

    let htmlPage;
    try {
      htmlPage = await fetch(`https://xxxtor.com/b.php?search=${encodeURIComponent(query)}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      }).then(r => r.text());
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const seen = new Set();

    // Извлекаем таблицу с торрентами
    const tableMatch = htmlPage.match(/<table[^>]*class="torrents_table"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return jsonResponse({ Results, Indexers: [] });
    }

    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*class="t-row"[^>]*>([\s\S]*?)<\/tr>/gi;
    let row;

    while ((row = rowRegex.exec(tableHtml)) !== null) {
      const block = row[1];

      // Извлекаем название и ID
      const titleMatch = block.match(/<a[^>]*href="\/t\/(\d+)\/[^"]*"[^>]*>(.*?)<\/a>/i);
      if (!titleMatch) continue;

      const id = titleMatch[1];
      const title = titleMatch[2].trim();

      if (seen.has(id)) continue;
      seen.add(id);

      // Извлекаем магнет-ссылку
      const magnetMatch = block.match(/<a[^>]*href="(magnet:\?[^"]+)"[^>]*>/i);
      const magnet = magnetMatch ? magnetMatch[1] : "";
      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      if (!hash) continue;

      // Извлекаем размер
      const sizeMatch = block.match(/<td[^>]*class="size"[^>]*>([\d.,]+)\s*(GB|MB|KB)<\/td>/i);
      const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

      // Извлекаем сиды и пиры
      const seedMatch = block.match(/<td[^>]*class="seeders"[^>]*>(\d+)<\/td>/i);
      const peerMatch = block.match(/<td[^>]*class="leechers"[^>]*>(\d+)<\/td>/i);
      const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
      const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

      Results.push({
        Title:       title,
        Seeders:     seeders,
        Peers:       peers,
        Size:        size,
        Tracker:     "XXXTor",
        MagnetUri:   `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`,
        Link:        `https://xxxtor.com/t/${id}`,
        PublishDate: new Date().toISOString(),
      });
    }

    Results.sort((a, b) => b.Seeders - a.Seeders);
    return jsonResponse({ Results, Indexers: [] });
  }
};

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  switch (unit.toUpperCase()) {
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
