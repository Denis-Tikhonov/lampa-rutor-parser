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

    const query = url.searchParams.get("Query") || url.searchParams.get("query");
    if (!query) {
      return jsonResponse({ Results: [], Indexers: [] });
    }

    const queryTokens = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const videoKeywords = /\b(mkv|mp4|avi|mov|wmv|ts|m2ts|1080p|720p|2160p|4k|uhd)\b/i;

    const Results = [];
    const seen = new Set();
    const debug = { query, trackers: {} };

    try {
      const encodedQuery = encodeURIComponent(query);

      // ===================================================
      // ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ
      // ===================================================
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        // Rutor
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        // NNMClub
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        // XXXTor
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        // LePorno.de (POST)
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://leporno.de/search.php"
          },
          body: new URLSearchParams({
            'keywords': query,
            'terms': 'all',
            'sr': 'topics',
            'sf': 'all',
            'submit': 'Search'
          }).toString()
        }).then(async r => {
          const text = await r.text();
          debug.trackers.leporno = { status: r.status, htmlLength: text.length };
          return text;
        }).catch(() => "")
      ]);

      // --- Парсинг Rutor ---
      for (const html of rutorPages) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let m;
        while ((m = rowRegex.exec(html)) !== null) {
          const b = m[1];
          const t = b.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
          if (!t) continue;
          const magnet = b.match(/href="(magnet:\?[^"]+)"/);
          if (!magnet) continue;
          const hash = (magnet[1].match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
          if (seen.has(hash)) continue; seen.add(hash);
          const s = b.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
          const sd = b.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
          Results.push({
            Title: t[2].trim(), Seeders: sd ? parseInt(sd[1]) : 0, Tracker: "Rutor",
            Size: s ? parseSizeToBytes(s[1], s[2]) : 0,
            MagnetUri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(t[2])}`,
            Link: `https://rutor.info/torrent/${t[1]}`
          });
        }
      }

      // --- Парсинг NNM ---
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        const items = [];
        for (const r of rows) {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (!t) continue;
          const s = r.match(/<u>\d+<\/u>\s*([\d.,]+)\s*(GB|MB|KB)/i);
          const sd = r.match(/class="seedmed"><b>(\d+)<\/b>/);
          items.push({ id: t[1], title: t[2].trim(), size: s ? parseSizeToBytes(s[1], s[2]) : 0, seeds: sd ? parseInt(sd[1]) : 0 });
        }
        await Promise.all(items.slice(0, 15).map(async it => {
          const res = await fetch(`https://nnmclub.to/forum/viewtopic.php?t=${it.id}`).then(r => r.arrayBuffer());
          const th = new TextDecoder("windows-1251").decode(res);
          const m = th.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"]*)"/i);
          if (m) Results.push({ Title: it.title, Seeders: it.seeds, Size: it.size, Tracker: "NNMClub", MagnetUri: m[1], Link: `https://nnmclub.to/forum/viewtopic.php?t=${it.id}` });
        }));
      }

      // --- Парсинг XXXTor ---
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of xtRows) {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        if (!t) continue;
        const magnet = r.match(/href=["'](magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"']*)["']/i);
        const s = r.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
        Results.push({
          Title: t[2].trim(), Tracker: "XXXTor", MagnetUri: magnet ? magnet[1].replace(/&amp;/g, '&') : "",
          Size: s ? parseSizeToBytes(s[1], s[2]) : 0, Seeders: 0, Link: `https://xxxtor.com/torrent/${t[1]}/`
        });
      }

      // ===================================================
      // ОБНОВЛЕННЫЙ ПАРСИНГ LePorno.de
      // ===================================================
      if (lepornoHtml) {
        // Гибкий поиск ссылок на топики
        const topicRegex = /viewtopic\.php\?[^"']*t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/gi;
        const lepornoItems = [];
        let tm;
        while ((tm = topicRegex.exec(lepornoHtml)) !== null) {
          const topicId = tm[1];
          let title = tm[2].replace(/<[^>]+>/g, '').trim();
          if (!seen.has(`lep_${topicId}`)) {
            seen.add(`lep_${topicId}`);
            lepornoItems.push({ topicId, title });
          }
          if (lepornoItems.length >= 20) break; // Лимит, чтобы не спамить
        }

        debug.trackers.leporno.foundTopics = lepornoItems.length;

        if (lepornoItems.length > 0) {
          await Promise.all(lepornoItems.map(async item => {
            try {
              const res = await fetch(`https://leporno.de/viewtopic.php?t=${item.topicId}`, {
                headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://leporno.de/search.php" }
              });
              const html = await res.text();

              const fileMatch = html.match(/download\/file\.php\?id=(\d+)/);
              if (!fileMatch) return;

              const sizeMatch = html.match(/(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);
              const seedMatch = html.match(/class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b>/i);

              // Для LePorno делаем прямой запрос на получение магнета, если возможно
              const magRes = await fetch(`https://leporno.de/download/file.php?id=${fileMatch[1]}&magnet=1`, {
                headers: { "User-Agent": "Mozilla/5.0", "Referer": `https://leporno.de/viewtopic.php?t=${item.topicId}` },
                redirect: 'manual'
              });
              
              const magnet = magRes.headers.get('Location') || "";

              Results.push({
                Title: item.title,
                Seeders: seedMatch ? parseInt(seedMatch[1]) : 0,
                Size: sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0,
                Tracker: "LePorno.de",
                MagnetUri: magnet.startsWith('magnet') ? magnet : `https://leporno.de/download/file.php?id=${fileMatch[1]}`,
                Link: `https://leporno.de/viewtopic.php?t=${item.topicId}`
              });
            } catch (e) {}
          }));
        }
      }

    } catch (e) {
      debug.error = e.message;
    }

    Results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));
    
    debug.byTracker = {
      Rutor: Results.filter(r => r.Tracker === "Rutor").length,
      NNMClub: Results.filter(r => r.Tracker === "NNMClub").length,
      XXXTor: Results.filter(r => r.Tracker === "XXXTor").length,
      LePorno: Results.filter(r => r.Tracker === "LePorno.de").length
    };

    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"], debug });
  }
};

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  const u = unit.toUpperCase();
  const factor = { 'TB': 1024**4, 'ТБ': 1024**4, 'GB': 1024**3, 'ГБ': 1024**3, 'MB': 1024**2, 'МБ': 1024**2, 'KB': 1024, 'КБ': 1024 };
  return Math.round(n * (factor[u] || 0));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
