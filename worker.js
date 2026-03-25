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

      const title = extractTag(block, "title");
      const link  = extractTag(block, "link");

      if (!title) continue;

      // Ищем magnet везде где он может быть
      let magnet = "";

      // 1. В теге <enclosure url="magnet:...">
      const enclosureMatch = block.match(/<enclosure[^>]+url="(magnet:[^"]+)"/i);
      if (enclosureMatch) magnet = enclosureMatch[1];

      // 2. Просто в тексте блока
      if (!magnet) {
        const textMatch = block.match(/magnet:\?[^"<\s&]+/);
        if (textMatch) magnet = textMatch[0];
      }

      // 3. В теге <link> если там magnet
      if (!magnet && link.startsWith("magnet:")) magnet = link;

      const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      Results.push({
        Title:       title,
        Seeders:     0,
        Peers:       0,
        Size:        0,
        Tracker:     "Rutor",
        MagnetUri:   hash
          ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
          : magnet,
        Link:        link.startsWith("magnet:") ? "" : link,
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

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
