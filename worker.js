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

    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);

    const Results = [];
    const seen = new Set();

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

        // Фильтр по названию
        if (queryTokens.length > 0) {
          const titleLower = title.toLowerCase();
          const matched = queryTokens.filter(t => titleLower.includes(t));
          if (matched.length / queryTokens.length < 0.5) continue;
        }

        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash   = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        if (!hash) continue;

        const sizeMatch = block.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Исправленные regex для классов .green и .red
        const seedMatch = block.match(/<[^>]*class="green"[^>]*>(\d+)<\/[^>]+>/);
        const peerMatch = block.match(/<[^>]*class="red"[^>]*>(\d+)<\/[^>]+>/);
        const seeders   = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers     = peerMatch ? parseInt(peerMatch[1]) : 0;

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "Rutor",
          MagnetUri:   `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`,
