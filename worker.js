export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS
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

    // 🔥 URL поиска — сюда подставляешь любой сайт
    const searchUrl = `https://rutor.info/rss.php?search=${encodeURIComponent(query)}`;

    let xml = "";
    try {
      xml = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
      }).then(r => r.text());
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let item;

    while ((item = itemRegex.exec(xml)) !== null) {
      const block = item[1];

      const title = extractTag(block, "title");
      const link  = extractTag(block, "link");

      if (!title) continue;

      // magnet из RSS
      const magnet = (block.match(/magnet:\?[^"<\s]+/) || [])[0] || "";
      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      // качество
      const quality = detectQuality(title);

      // размер (RSS rutor не даёт — ставим 0)
      const size = 0;

      // сиды (RSS rutor не даёт — ставим 0)
      const seeders = 0;

      Results.push({
        Title: title,
        MagnetUri: hash
          ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
          : magnet,
        Seeders: seeders,
        Size: size,
        Tracker: "Rutor",
        PublishDate: new Date().toISOString(),
        Quality: quality
      });
    }

    // 🔥 сортировка по качеству
    Results.sort((a, b) => qualityRank(b.Quality) - qualityRank(a.Quality));

    return jsonResponse({
      Results,
      Indexers: ["Rutor"]
    });
  }
};

// -----------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// -----------------------------

function detectQuality(t) {
  return (t.match(/2160p|4K|1080p|720p|WEBRip|BDRip|HDRip/i) || ["unknown"])[0];
}

function qualityRank(q) {
  const order = ["2160p", "4K", "1080p", "720p", "WEBRip", "BDRip", "HDRip", "unknown"];
  const i = order.indexOf(q);
  return i === -1 ? order.length : i;
}

function extractTag(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*><!\

\[CDATA\

\[([\\s\\S]*?)\\]

\\]

><\\/${tag}>`, "i"))
    || str.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
