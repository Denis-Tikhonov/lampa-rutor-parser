export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
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

    // RSS Rutor — содержит настоящие magnet-ссылки с реальным хэшем
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

    // Парсим каждый <item> целиком
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let item;

    while ((item = itemRegex.exec(xml)) !== null) {
      const block = item[1];

      const title     = extractTag(block, "title");
      const link      = extractTag(block, "link");
      const magnet    = extractMagnet(block);       // из <link> или <enclosure>
      const sizeStr   = extractTag(block, "size");
      const seeders   = parseInt(extractTag(block, "seeders") || "0");
      const peers     = parseInt(extractTag(block, "peers")   || "0");

      if (!title || !link) continue;

      // Настоящий хэш — из magnet-ссылки в RSS
      const hash  = magnet?.match(/btih:([a-fA-F0-9]{40})/i)?.[1] || "";
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
        Size:        parseSizeToBytes(sizeStr),
        Seeders:     seeders,
        Peers:       peers,
        CategoryDesc: "Movies",
        Category:    [2000],
        PublishDate: new Date().toISOString(),
      });
    }

    return jsonResponse({ Results, Indexers: [] });
  }
};

// --- Хелперы ---

function extractTag(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || str.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function extractMagnet(block) {
  // Rutor обычно кладёт magnet в <link> или отдельным тегом
  const m = block.match(/magnet:\?[^"<\s]+/);
  return m ? m[0] : "";
}

function parseSizeToBytes(str) {
  if (!str) return 0;
  const m = str.match(/([\d.]+)\s*(GB|MB|KB)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "").toUpperCase();
  if (unit === "GB") return Math.round(n * 1024 ** 3);
  if (unit === "MB") return Math.round(n * 1024 ** 2);
  if (unit === "KB") return Math.round(n * 1024);
  return Math.round(n);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
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

    // RSS Rutor — содержит настоящие magnet-ссылки с реальным хэшем
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

    // Парсим каждый <item> целиком
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let item;

    while ((item = itemRegex.exec(xml)) !== null) {
      const block = item[1];

      const title     = extractTag(block, "title");
      const link      = extractTag(block, "link");
      const magnet    = extractMagnet(block);       // из <link> или <enclosure>
      const sizeStr   = extractTag(block, "size");
      const seeders   = parseInt(extractTag(block, "seeders") || "0");
      const peers     = parseInt(extractTag(block, "peers")   || "0");

      if (!title || !link) continue;

      // Настоящий хэш — из magnet-ссылки в RSS
      const hash  = magnet?.match(/btih:([a-fA-F0-9]{40})/i)?.[1] || "";
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
        Size:        parseSizeToBytes(sizeStr),
        Seeders:     seeders,
        Peers:       peers,
        CategoryDesc: "Movies",
        Category:    [2000],
        PublishDate: new Date().toISOString(),
      });
    }

    return jsonResponse({ Results, Indexers: [] });
  }
};

// --- Хелперы ---

function extractTag(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || str.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function extractMagnet(block) {
  // Rutor обычно кладёт magnet в <link> или отдельным тегом
  const m = block.match(/magnet:\?[^"<\s]+/);
  return m ? m[0] : "";
}

function parseSizeToBytes(str) {
  if (!str) return 0;
  const m = str.match(/([\d.]+)\s*(GB|MB|KB)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "").toUpperCase();
  if (unit === "GB") return Math.round(n * 1024 ** 3);
  if (unit === "MB") return Math.round(n * 1024 ** 2);
  if (unit === "KB") return Math.round(n * 1024);
  return Math.round(n);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}export default {
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
    const html = await fetch(searchUrl, {
  headers: {
    "User-Agent": "Mozilla/5.0"
  }
}).then(r => r.text());

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
