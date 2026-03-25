export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");

    if (!query) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const searchUrl = `https://rutor.info/search/0/0/010/0/${encodeURIComponent(query)}`;
    const html = await fetch(searchUrl).then(r => r.text());

    const results = [];

    const regex = /<a href="\/torrent\/(\d+)\/[^"]+">([^<]+)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const title = match[2];

      results.push({
        title: title,
        url: `https://rutor.info/torrent/${id}`,
        magnet: `magnet:?xt=urn:btih:${id}`,
        quality: title.match(/720p|1080p|2160p|HDRip|BDRip/i)?.[0] || "unknown"
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
