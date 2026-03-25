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

    // Категории: 1=зарубежные фильмы, 2=наши фильмы, 4=зарубежные сериалы, 5=наши сериалы, 10=мультфильмы
    const categories = [1, 2, 4, 5, 10];

    let htmlPages = [];
    try {
      htmlPages = await Promise.all(
        categories.map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text())
        )
      );
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const seen = new Set(); // защита от дублей

    for (const html of htmlPages) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let row;

      while ((row = rowRegex.exec(html)) !== null) {
        const block = row[1];

        const titleMatch = block.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
        if (!titleMatch) continue;

        const id    = titleMatch[1];
        const title = titleMatch[2].trim();

        if (seen.has(id)) continue;
        seen.add(id);

        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash   = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        const sizeMatch = block.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        const seedMatch = block.match(/<font color="#00b000">(\d+)<\/font>/);
        const peerMatch = block.match(/<font color="red">(\d+)<\/font>/);
        const seeders   = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers     = peerMatch ? parseInt(peerMatch[1]) : 0;

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "Rutor",
          MagnetUri:   hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
            : magnet,
          Link:        `https://rutor.info/torrent/${id}`,
          PublishDate: new Date().toISOString(),
        });
      }
    }

    // Сортируем по сидам — живые раздачи вверху
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
