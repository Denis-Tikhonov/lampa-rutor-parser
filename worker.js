export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ===================================================
    // CORS & OPTIONS
    // ===================================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        }
      });
    }

    const query = url.searchParams.get("Query") || url.searchParams.get("query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [], Message: "Введите запрос через ?Query=" });
    }

    const encodedQuery = encodeURIComponent(query);
    const queryTokens = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const videoKeywords = /\b(mkv|mp4|avi|mov|wmv|ts|m2ts|remux|bluray|1080p|720p|2160p|4k|uhd)\b/i;

    const Results = [];
    const seen = new Set();
    const debug = { query, trackers: {} };

    try {
      // ===================================================
      // 1. ПЕРВИЧНЫЕ ЗАПРОСЫ (ПАРАЛЛЕЛЬНО)
      // ===================================================
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        // Rutor (поиск по категориям: Кино, Сериалы, Мультимедиа)
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        // NNMClub (нужен Buffer для кодировки Windows-1251)
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        // XXXTor
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        // LePorno.de (POST-запрос для обхода ограничений phpBB)
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://leporno.de/search.php"
          },
          body: new URLSearchParams({ 'keywords': query, 'terms': 'all', 'sr': 'topics', 'sf': 'all', 'submit': 'Search' }).toString()
        }).then(r => r.text()).catch(() => "")
      ]);

      // ===================================================
      // 2. ПАРСИНГ RUTOR
      // ===================================================
      for (const html of rutorPages) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let m;
        while ((m = rowRegex.exec(html)) !== null) {
          const b = m[1];
          const t = b.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
          if (!t) continue;
          const magnetMatch = b.match(/href="(magnet:\?[^"]+)"/);
          if (!magnetMatch) continue;
          const hash = (magnetMatch[1].match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
          if (seen.has(hash)) continue; seen.add(hash);

          const sizeInfo = b.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
          const seeds = b.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
          const leech = b.match(/<span class="red">[\s\S]*?&nbsp;(\d+)<\/span>/);

          Results.push({
            Title: t[2].trim(),
            Seeders: seeds ? parseInt(seeds[1]) : 0,
            Peers: leech ? parseInt(leech[1]) : 0,
            Size: sizeInfo ? parseSizeToBytes(sizeInfo[1], sizeInfo[2]) : 0,
            Tracker: "Rutor",
            MagnetUri: magnetMatch[1].replace(/&amp;/g, '&'),
            Link: `https://rutor.info/torrent/${t[1]}`,
            PublishDate: new Date().toISOString()
          });
        }
      }

      // ===================================================
      // 3. ПАРСИНГ NNMCLUB (С ДОЗАПРОСОМ МАГНЕТОВ)
      // ===================================================
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        const nnmItems = [];
        for (const r of rows) {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (t) nnmItems.push({ id: t[1], title: t[2].trim() });
        }
        // Ограничиваем дозапросы для скорости
        await Promise.all(nnmItems.slice(0, 15).map(async it => {
          try {
            const res = await fetch(`https://nnmclub.to/forum/viewtopic.php?t=${it.id}`).then(r => r.arrayBuffer());
            const th = new TextDecoder("windows-1251").decode(res);
            const magnet = th.match(/href="(magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"]*)"/i);
            if (magnet && !seen.has(magnet[2].toLowerCase())) {
              seen.add(magnet[2].toLowerCase());
              const size = th.match(/Размер:[\s\S]*?<b>([\d.,]+)\s*(GB|MB|KB|ГБ|МБ|КБ)<\/b>/i);
              const seeds = th.match(/seedmed"><b>(\d+)<\/b>/);
              Results.push({
                Title: it.title, Seeders: seeds ? parseInt(seeds[1]) : 0, Peers: 0,
                Size: size ? parseSizeToBytes(size[1], size[2]) : 0,
                Tracker: "NNMClub", MagnetUri: magnet[1].replace(/&amp;/g, '&'),
                Link: `https://nnmclub.to/forum/viewtopic.php?t=${it.id}`,
                PublishDate: new Date().toISOString()
              });
            }
          } catch (e) {}
        }));
      }

      // ===================================================
      // 4. ПАРСИНГ XXXTOR
      // ===================================================
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of xtRows) {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        if (!t) continue;
        const magnet = r.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
        if (magnet && !seen.has(magnet[2].toLowerCase())) {
          seen.add(magnet[2].toLowerCase());
          const size = r.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
          const seeds = r.match(/class=["']green["'][^>]*>[\s\S]*?&nbsp;(\d+)/i);
          Results.push({
            Title: t[2].trim(), Seeders: seeds ? parseInt(seeds[1]) : 0, Peers: 0,
            Size: size ? parseSizeToBytes(size[1], size[2]) : 0,
            Tracker: "XXXTor", MagnetUri: magnet[1].replace(/&amp;/g, '&'),
            Link: `https://xxxtor.com/torrent/${t[1]}/`,
            PublishDate: new Date().toISOString()
          });
        }
      }

      // ===================================================
      // 5. ПАРСИНГ LEPORNO.DE (ГЛУБОКИЙ ПАРСИНГ)
      // ===================================================
      if (lepornoHtml) {
        const topicRegex = /viewtopic\.php\?[^"']*t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/gi;
        const lepItems = [];
        let tm;
        while ((tm = topicRegex.exec(lepornoHtml)) !== null) {
          lepItems.push({ id: tm[1], title: tm[2].replace(/<[^>]+>/g, '').trim() });
          if (lepItems.length >= 15) break;
        }

        await Promise.all(lepItems.map(async item => {
          try {
            const res = await fetch(`https://leporno.de/viewtopic.php?t=${item.id}`);
            const h = await res.text();
            const fileId = h.match(/download\/file\.php\?id=(\d+)/);
            if (fileId) {
              const size = h.match(/(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);
              const seeds = h.match(/class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b>/i);
              Results.push({
                Title: item.title, Seeders: seeds ? parseInt(seed[1]) : 0, Peers: 0,
                Size: size ? parseSizeToBytes(size[1], size[2]) : 0,
                Tracker: "LePorno.de", MagnetUri: `https://leporno.de/download/file.php?id=${fileId[1]}&magnet=1`,
                Link: `https://leporno.de/viewtopic.php?t=${item.id}`,
                PublishDate: new Date().toISOString()
              });
            }
          } catch (e) {}
        }));
      }

    } catch (e) {
      debug.error = e.message;
    }

    // Сортировка: сначала те, где больше сидов
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ 
      Results, 
      Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"],
      Total: Results.length,
      Debug: debug 
    });
  }
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function parseSizeToBytes(num, unit) {
  if (!num) return 0;
  const n = parseFloat(num.replace(",", "."));
  const u = unit.toUpperCase();
  const map = {
    'TB': 1024**4, 'ТБ': 1024**4,
    'GB': 1024**3, 'ГБ': 1024**3,
    'MB': 1024**2, 'МБ': 1024**2,
    'KB': 1024,    'КБ': 1024
  };
  return Math.round(n * (map[u] || 1));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*" 
    }
  });
}
