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
      const title  = extractTag(block, "title");
      const link   = extractTag(block, "link");
      const magnet = (block.match(/magnet:\?[^"<\s]+/) || [])[0] || "";
      const hash   = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      if (!title) continue;

      const quality = detectQuality(title);

      Results.push({
        Title:      title,
        Seeders:    0,
        Size:       0,
        Tracker:    "Rutor",
        MagnetUri:  hash
          ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
          : magnet,
        Link:       link,
        PublishDate: new Date().toISOString(),
        Quality:    quality
      });
    }

    // простая сортировка по качеству
    Results.sort((a, b) => qualityRank(b.Quality) - qualityRank(a.Quality));

    return jsonResponse({ Results, Indexers: [] });
  }
};

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
