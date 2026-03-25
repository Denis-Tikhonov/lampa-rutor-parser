export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");

    if (!query) {
      return new Response(JSON.stringify({ results: [], torrents: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const rssUrl = `https://rutor.info/rss.php?search=${encodeURIComponent(query)}`;

    const xml = await fetch(rssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }).then(r => r.text());

    const items = [];

    const regex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const title = match[1];
      const link = match[2];
      const id = link.match(/torrent\/(\d+)/)?.[1];

      if (!id) continue;

      items.push({
        title,
        name: title,               // для модов
        url: link,
        magnet: `magnet:?xt=urn:btih:${id}`,
        quality: title.match(/2160p|1080p|720p|HDRip|BDRip|WEBRip/i)?.[0] || "unknown"
      });
    }

    // Оригинальная Lampa → results
    // Моды → torrents
    return new Response(JSON.stringify({
      results: items,
      torrents: items
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
