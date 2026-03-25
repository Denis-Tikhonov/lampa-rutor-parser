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
        headers: { "User-Agent": "Mozilla/5.0" }
      }).then(r => r.text());
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    // Готовим слова запроса для фильтрации — разбиваем на токены
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);

    const Results = [];
    const seen = new Set();

    // Парсинг таблицы с раздачами
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let row;

    while ((row = rowRegex.exec(htmlPage)) !== null) {
      const block = row[1];

      // Извлечение названия и ссылки
      const titleMatch = block.match(/href="\/t\/(\d+)\/[^"]*">([^<]+)<\/a>/);
      if (!titleMatch) continue;

      const id = titleMatch[1];
      const title = titleMatch[2].trim();

      if (seen.has(id)) continue;
      seen.add(id);

      // Фильтрация по совпадению слов запроса
      const titleLower = title.toLowerCase();
      if (queryTokens.length > 0) {
        const matched = queryTokens.filter(token => titleLower.includes(token));
        const matchRatio = matched.length / queryTokens.length;
        if (matchRatio < 0.5) continue;
      }

      // Извлечение магнета
      const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
      const magnet = magnetMatch ? magnetMatch[1] : "";
      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      if (!hash) continue;

      // Извлечение размера
      const sizeMatch = block.match(/([\d.,]+)\s*(GB|MB|KB)/i);
      const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

      // Извлечение сидов и пиров
      const seedMatch = block.match(/(\d+)\s*<img[^>]*seed[^>]*>/i);
      const peerMatch = block.match(/(\d+)\s*<img[^>]*peer[^>]*>/i);
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
