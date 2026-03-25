const API_KEYS = new Set([
  "your-secret-key-1",  // Замените на реальные ключи
  "your-secret-key-2",
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS support
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    // Check API key
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !API_KEYS.has(authHeader)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const query = url.searchParams.get("Query") || url.searchParams.get("query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    // Pornolab categories (optional: 1=Video, 2=Images, etc.)
    const categories = ["0"]; // "0" = all categories
    let htmlPages = [];

    try {
      htmlPages = await Promise.all(
        categories.map(cat =>
          fetch(`https://pornolab.net/forum/search.php?st=0&sr=topics&sf=titleonly&sk=t&sd=d&start=0&search=${encodeURIComponent(query)}&c[]=${cat}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text())
        )
      );
    } catch (e) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const Results = [];
    const seen = new Set(); // Avoid duplicates

    for (const html of htmlPages) {
      const rowRegex = /<tr class="[^"]*">([\s\S]*?)<\/tr>/g;
      let row;

      while ((row = rowRegex.exec(html)) !== null) {
        const block = row[1];
        const titleMatch = block.match(/<a href="\/forum\/viewtopic\.php\?t=(\d+)"[^>]*>(.*?)<\/a>/);
        if (!titleMatch) continue;

        const id = titleMatch[1];
        const title = titleMatch[2].trim();

        if (seen.has(id)) continue;
        seen.add(id);

        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        const sizeMatch = block.match(/(\d+[\.,]?\d*)\s*(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        const seedMatch = block.match(/<td[^>]*>(\d+)<\/td>/g);
        const seeders = seedMatch && seedMatch.length >= 3 ? parseInt(seedMatch[2].replace(/<[^>]+>/g, "")) : 0;
        const peers = seedMatch && seedMatch.length >= 4 ? parseInt(seedMatch[3].replace(/<[^>]+>/g, "")) : 0;

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,


```json
{
  "error": true,
  "message": "Error in input stream"
}
