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
    // ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ К ВСЕМ ТРЕКЕРАМ
    // ===================================================
    const RUTOR_CATEGORIES = [1, 2, 4, 5, 10];

    const [rutorPages, nnmBuffer, xxxtorResponse] = await Promise.all([
      // Rutor
      Promise.all(
        RUTOR_CATEGORIES.map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          }).then(r => r.text()).catch(() => "")
        )
      ),
      // NNMClub
      fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0" }
      }).then(r => r.arrayBuffer()).catch(() => null),
      // XXXTor
      fetch(`https://xxxtor.com/b.php?search=${encodeURIComponent(query)}`, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": "https://xxxtor.com/",
        }
      }).then(r => r.ok ? r.text() : "").catch(() => "")
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
    const nnmItems = [];

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

      if (!hash) continue;

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
    // ПАРСИНГ XXXTOR
    // ===================================================
    if (xxxtorResponse) {
      const xxxtorHtml = xxxtorResponse;
      
      // Парсим результаты поиска XXXTor
      const torrentRegex = /href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)(?:\/|&[^"']*)?([^"']*)?["']/gi;
      
      let match;
      while ((match = torrentRegex.exec(xxxtorHtml)) !== null) {
        const id = match[1];
        let slug = match[2] || "";
        slug = slug.replace(/[?&].*$/, '').trim();
        
        const key = `xxxtor_${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Формируем название
        let title = "";
        if (slug) {
          title = decodeURIComponent(slug.replace(/-/g, ' ')).trim();
        }
        
        // Ищем в ближайшем блоке
        const searchStart = Math.max(0, match.index - 1500);
        const searchEnd = Math.min(xxxtorHtml.length, match.index + 1500);
        const block = xxxtorHtml.substring(searchStart, searchEnd);

        if (!title) {
          const titleMatch = block.match(/<a[^>]*href=["'][^"']*torrent[^"']*["'][^>]*>([^<]+)<\/a>/i)
                          || block.match(/title=["']([^"']+)["']/i)
                          || block.match(/class=["'][^"']*title[^"']*["'][^>]*>([^<]+)/i);
          title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
        }

        // Пропускаем если не проходит фильтры
        if (!passFilters(title, queryTokens, videoKeywords)) continue;

        // Ищем magnet ссылку
        const magnetMatch = block.match(/href=["'](magnet:\?[^"']+)["']/i)
                         || xxxtorHtml.match(new RegExp(`href=["'](magnet:\\?[^"']*${id}[^"']*)["']`, 'i'));
        const magnet = magnetMatch ? magnetMatch[1] : "";
        
        // Извлекаем hash
        let hash = "";
        if (magnet) {
          const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
          if (hashMatch) hash = hashMatch[1].toLowerCase();
        }

        // Ищем размер файла
        const sizeMatch = block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i)
                       || block.match(/size[^>]*>(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Ищем сиды и пиры
        const seedMatch = block.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i)
                       || block.match(/seed[^>]*>(\d+)/i)
                       || block.match(/[↑↗]\s*(\d+)/);
        
        const peerMatch = block.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i)
                       || block.match(/leech[^>]*>(\d+)/i)
                       || block.match(/[↓↘]\s*(\d+)/);

        const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

        // Ищем дату
        const dateMatch = block.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)
                       || block.match(/(\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})/)
                       || block.match(/added[:\s]*([^<]+)/i);
        const publishDate = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString();

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "XXXTor",
          MagnetUri:   hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
            : magnet,
          Link:        `https://xxxtor.com/torrent/${id}/${slug || title.replace(/\s+/g, '-').substring(0, 50)}`,
          PublishDate: publishDate,
        });
      }

      // Альтернативный парсинг через table rows
      if (Results.filter(r => r.Tracker === "XXXTor").length === 0) {
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        
        while ((trMatch = trRegex.exec(xxxtorHtml)) !== null) {
          const row = trMatch[1];
          if (row.includes('<th')) continue;
          
          const linkMatch = row.match(/href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)/i);
          if (!linkMatch) continue;
          
          const id = linkMatch[1];
          const key = `xxxtor_${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          
          const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
          const titleCell = cells[0] || "";
          const sizeCell = cells[1] || "";
          const seedCell = cells[2] || "";
          const peerCell = cells[3] || "";
          
          const titleMatch = titleCell.match(/>([^<]+)<\/a>/);
          const title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
          
          if (!passFilters(title, queryTokens, videoKeywords)) continue;
          
          const sizeMatch = sizeCell.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          const seeders = parseInt(seedCell.replace(/<[^>]+>/g, '').trim()) || 0;
          const peers = parseInt(peerCell.replace(/<[^>]+>/g, '').trim()) || 0;
          
          Results.push({
            Title:       title,
            Seeders:     seeders,
            Peers:       peers,
            Size:        size,
            Tracker:     "XXXTor",
            MagnetUri:   "",
            Link:        `https://xxxtor.com/torrent/${id}`,
            PublishDate: new Date().toISOString(),
          });
        }
      }
    }

    // ===================================================
    // СОРТИРОВКА по сидам
    // ===================================================
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ 
      Results, 
      Indexers: ["Rutor", "NNMClub", "XXXTor"] 
    });
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
