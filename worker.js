export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const query = url.searchParams.get("Query") || url.searchParams.get("query");

    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    let xml = "";
    try {
      xml = await fetch(`https://rutor.info/rss.php?search=${encodeURIComponent(query)}`, {
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
      const magnet = (block.match(/magnet:\?[^"<\s]+/) || [])[0] || "";
      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      if (!title) continue;

      // ❌ Убираем всё, кроме фильмов и сериалов
      if (isTrash(title)) continue;

      const quality = detectQuality(title);
      const bitrate = detectBitrate(title);
      const seeders = detectSeeders(title);

      Results.push({
        Title: title,
        Seeders: seeders,
        Size: 0,
        Tracker: "Rutor",
        MagnetUri: hash
          ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
          : magnet,
        Link: link,
        PublishDate: new Date().toISOString(),
        Quality: quality,
        Bitrate: bitrate
      });
    }

    // 🔥 Сортировка: качество → сидеры → название
    Results.sort((a, b) => {
      const q = qualityRank(b.Quality) - qualityRank(a.Quality);
      if (q !== 0) return q;

      const s = b.Seeders - a.Seeders;
      if (s !== 0) return s;

      return a.Title.localeCompare(b.Title);
    });

    return jsonResponse({ Results, Indexers: [] });
  }
};

// -----------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// -----------------------------

function detectQuality(t) {
  return (t.match(/2160p|4K|1080p|720p|WEBRip|BDRip|HDRip/i) || ["unknown"])[0];
}

function detectBitrate(t) {
  return (t.match(/\b\d{3,4}kbps\b/i) || ["unknown"])[0];
}

function detectSeeders(t) {
  // Rutor RSS не даёт сидеров — делаем эвристику:
  if (/2160p|4K/i.test(t)) return 50;
  if (/1080p/i.test(t)) return 30;
  if (/720p/i.test(t)) return 15;
  return 5;
}

function qualityRank(q) {
  const order = ["2160p", "4K", "1080p", "720p", "WEBRip", "BDRip", "HDRip", "unknown"];
  return order.indexOf(q);
}

function isTrash(title) {
  return /MP3|FLAC|RePack|Portable|PC\s*Game|Switch|PS4|PS5|EPUB|FB2|Audio|Soundtrack|OST|Lossless/i.test(title);
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
