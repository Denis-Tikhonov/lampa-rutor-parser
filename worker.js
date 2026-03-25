export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");

    // Если запрос пустой — возвращаем пустой массив
    if (!query) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // RSS поиск по rutor
    const rssUrl = `https://rutor.info/rss.php?search=${encodeURIComponent(query)}`;

    // Делаем запрос с нормальным User-Agent
    const xml = await fetch(rssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }).then(r => r.text());

    const results = [];

    // Парсим RSS
    const regex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const title = match[1];
      const link = match[2];

      // Извлекаем ID торрента
      const id = link.match(/torrent\/(\d+)/)?.[1];

      results.push({
        title,
        url: link,
        magnet: `magnet:?xt=urn:btih:${id}`,
        quality: title.match(/2160p|1080p|720p|HDRip|BDRip|WEBRip/i)?.[0] || "unknown"
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
