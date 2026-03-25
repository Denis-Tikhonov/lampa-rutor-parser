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

    const query = url.searchParams.get("query") || url.searchParams.get("Query");

    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const rssUrl = `https://rutor.info/rss.php?search=${encodeURIComponent(query)}`;

    let xml = "";
    try {
      xml = await fetch(rssUrl, {
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
      const magnet = extractMagnet(block);

      if (!title || !link) continue;

      const hash = magnet?.match(/btih:([a-fA-F0-9]{40})/i)?.[1] || "";
      const realMagnet = hash
        ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
        : magnet || "";

      Results.push({
        Tracker:     "Rutor",
        TrackerId:   "rutor",
        Title:       title,
        Guid:        link,
        Details:     link,
        Link:        link,
        MagnetUri:   realMagnet,
        Size:        0,
        Seeders:     0,
        Peers:       0,
        CategoryDesc: "Movies",
        Category:    [2000],
        PublishDate: new Date().toISOString(),
      });
    }

    return jsonResponse({ Results, Indexers: [] });
  }
};

function extractTag(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || str.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function extractMagnet(block) {
  const m = block.match(/magnet:\?[^"<\s]+/);
  return m ? m[0] : "";
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
