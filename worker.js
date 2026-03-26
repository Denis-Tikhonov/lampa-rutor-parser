export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ===================================================
    // CORS
    // ===================================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    // ===================================================
    // ПАРАМЕТРЫ ЗАПРОСА
    // ===================================================
    const query = url.searchParams.get("Query") || url.searchParams.get("query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    // ===================================================
    // ФИЛЬТРЫ
    // ===================================================
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);

    const videoKeywords = /\b(mkv|mp4|avi|mov|wmv|ts|m2ts|remux|bluray|blu-ray|bdrip|webrip|webdl|web-dl|hdtv|hdrip|dvdrip|xvid|x264|x265|hevc|h264|h\.264|h265|h\.265|1080p|720p|2160p|4k|uhd|av1)\b/i;

    // ===================================================
    // ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ К ОБОИМ САЙТАМ
    // ===================================================
    const RUTOR_CATEGORIES = [1, 2, 4, 5, 10];

    const [rutorPages, nnmBuffer] = await Promise.all([
      Promise.all(
        RUTOR_CATEGORIES.map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text()).catch(() => "")
        )
      ),
      // NNMClub отдаёт Windows-1251 — получаем как ArrayBuffer
      fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0" }
      }).then(r => r.arrayBuffer()).catch(() => null)
    ]);

    // Декодируем NNMClub из Windows-1251 в UTF-8
    const nnmHtml = nnmBuffer
      ? new TextDecoder("windows-1251").decode(nnmBuffer)
      : "";

    const Results = [];
    const seen = new Set();

    // ===================================================
    // ПАРСИНГ RUTOR
    // ===================================================
    for (const html of rutorPages) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let row;

      while ((row = rowRegex.exec(html)) !== null) {
        const block = row[1];

        const titleMatch = block.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
        if (!titleMatch) continue;

        const id    = titleMatch[1];
        const title = titleMatch[2].trim();
        const key   = `rutor_${id}`;

        if (seen.has(key)) continue;
        seen.add(key);

        if (!passFilters(title, queryTokens, videoKeywords)) continue;

        const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
        const magnet = magnetMatch ? magnetMatch[1] : "";
        const hash   = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

        if (!hash) continue;

        const sizeMatch = block.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        const seedMatch = block.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
        const peerMatch = block.match(/<span class="red">[\s\S]*?&nbsp;(\d+)<\/span>/);

        Results.push({
          Title:       title,
          Seeders:     seedMatch ? parseInt(seedMatch[1]) : 0,
          Peers:       peerMatch ? parseInt(peerMatch[1]) : 0,
          Size:        size,
          Tracker:     "Rutor",
          MagnetUri:   `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`,
          Link:        `https://rutor.info/torrent/${id}`,
          PublishDate: new Date().toISOString(),
        });
      }
    }

    // ===================================================
    // ПАРСИНГ NNMCLUB — сбор ID раздач
    // ===================================================
    const nnmItems = []; // { id, title, size, seeders, peers }

    const nnmRowRegex = /<tr class="p?row[12]">([\s\S]*?)<\/tr>/g;
    let nnmRow;

    while ((nnmRow = nnmRowRegex.exec(nnmHtml)) !== null) {
      const block = nnmRow[1];

      const titleMatch = block.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
      if (!titleMatch) continue;

      const id    = titleMatch[1];
      const title = titleMatch[2].trim();
      const key   = `nnm_${id}`;

      if (seen.has(key)) continue;
      seen.add(key);

      if (!passFilters(title, queryTokens, videoKeywords)) continue;

      const sizeMatch = block.match(/<u>\d+<\/u>\s*([\d.,]+)\s*(GB|MB|KB)/i);
      const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

      const seedMatch = block.match(/class="seedmed"><b>(\d+)<\/b>/);
      const peerMatch = block.match(/class="leechmed"><b>(\d+)<\/b>/);

      nnmItems.push({
        id,
        title,
        size,
        seeders: seedMatch ? parseInt(seedMatch[1]) : 0,
        peers:   peerMatch ? parseInt(peerMatch[1]) : 0,
      });
    }

    // ===================================================
    // ДОП. ЗАПРОСЫ НА СТРАНИЦЫ NNMCLUB — получаем magnet
    // Параллельно для всех найденных раздач
    // ===================================================
    const nnmMagnets = await Promise.all(
      nnmItems.map(item =>
        fetch(`https://nnmclub.to/forum/viewtopic.php?t=${item.id}`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        })
          .then(r => r.arrayBuffer())
          .then(buf => {
            const html = new TextDecoder("windows-1251").decode(buf);
            const m = html.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"]*)"/i);
            return m ? m[1] : "";
          })
          .catch(() => "")
      )
    );

    // Собираем NNMClub результаты с magnet
    for (let i = 0; i < nnmItems.length; i++) {
      const item   = nnmItems[i];
      const magnet = nnmMagnets[i];
      const hash   = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1] || "";

      if (!hash) continue; // без magnet не добавляем

      Results.push({
        Title:       item.title,
        Seeders:     item.seeders,
        Peers:       item.peers,
        Size:        item.size,
        Tracker:     "NNMClub",
        MagnetUri:   `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.title)}`,
        Link:        `https://nnmclub.to/forum/viewtopic.php?t=${item.id}`,
        PublishDate: new Date().toISOString(),
      });
    }

    // ===================================================
    // СОРТИРОВКА по сидам
    // ===================================================
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub"] });
  }
};

// ===================================================
// ФИЛЬТРАЦИЯ — название + видео формат
// ===================================================
function passFilters(title, queryTokens, videoKeywords) {
  if (!videoKeywords.test(title)) return false;
  if (queryTokens.length > 0) {
    const tl = title.toLowerCase();
    const matched = queryTokens.filter(t => tl.includes(t));
    if (matched.length / queryTokens.length < 0.5) return false;
  }
  return true;
}

// ===================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===================================================
function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  switch (unit.toUpperCase()) {
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
