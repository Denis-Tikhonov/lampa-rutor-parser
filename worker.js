export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS
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
    if (!query) return jsonResponse({ Results: [], Message: "Бро, введи Query!" });

    const encodedQuery = encodeURIComponent(query);
    const Results = [];
    const seen = new Set();
    const detailTasks = []; // Очередь на дозапрос постеров

    try {
      // 1. ПЕРВИЧНЫЙ ПОИСК (ПАРАЛЛЕЛЬНО)
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        Promise.all([1, 2, 4, 5, 10].map(cat => 
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""))),
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ 'keywords': query, 'terms': 'all', 'sr': 'topics', 'sf': 'all', 'submit': 'Search' }).toString()
        }).then(r => r.text()).catch(() => "")
      ]);

      // --- СОБИРАЕМ КАНДИДАТОВ С RUTOR ---
      for (const html of rutorPages) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let m;
        while ((m = rowRegex.exec(html)) !== null) {
          const b = m[1];
          const t = b.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
          const mag = b.match(/href="(magnet:\?[^"]+)"/);
          if (t && mag) {
            const hash = (mag[1].match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
            if (!seen.has(hash)) {
              const size = b.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
              const seeds = b.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
              detailTasks.push({
                id: t[1], title: t[2].trim(), hash, tracker: "Rutor", 
                url: `https://rutor.info/torrent/${t[1]}`,
                magnet: mag[1], seeds: seeds ? parseInt(seeds[1]) : 0,
                size: size ? parseSizeToBytes(size[1], size[2]) : 0
              });
              seen.add(hash);
            }
          }
        }
      }

      // --- СОБИРАЕМ КАНДИДАТОВ С NNMCLUB ---
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        rows.slice(0, 12).forEach(r => {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (t) detailTasks.push({ id: t[1], title: t[2].trim(), tracker: "NNMClub", url: `https://nnmclub.to/forum/viewtopic.php?t=${t[1]}` });
        });
      }

      // --- СОБИРАЕМ КАНДИДАТОВ С XXXTOR ---
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      xtRows.slice(0, 10).forEach(r => {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        const mag = r.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
        if (t && mag && !seen.has(mag[2].toLowerCase())) {
          const size = r.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
          const seeds = r.match(/class=["']green["'][^>]*>[\s\S]*?&nbsp;(\d+)/i);
          detailTasks.push({
            id: t[1], title: t[2].trim(), hash: mag[2].toLowerCase(), tracker: "XXXTor",
            url: `https://xxxtor.com/torrent/${t[1]}/`, magnet: mag[1].replace(/&amp;/g, '&'),
            seeds: seeds ? parseInt(seeds[1]) : 0, size: size ? parseSizeToBytes(size[1], size[2]) : 0
          });
          seen.add(mag[2].toLowerCase());
        }
      });

      // --- СОБИРАЕМ КАНДИДАТОВ С LEPORNO ---
      if (lepornoHtml) {
        const topicRegex = /viewtopic\.php\?[^"']*t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/gi;
        let tm;
        while ((tm = topicRegex.exec(lepornoHtml)) !== null) {
          detailTasks.push({ id: tm[1], title: tm[2].replace(/<[^>]+>/g, '').trim(), tracker: "LePorno.de", url: `https://leporno.de/viewtopic.php?t=${tm[1]}` });
          if (detailTasks.filter(x => x.tracker === "LePorno.de").length >= 10) break;
        }
      }

      // 2. ГЛУБОКИЙ ПАРСИНГ ВСЕХ ПОСТЕРОВ (ОГРАНИЧИВАЕМ ОЧЕРЕДЬ ДО 45 ШТУК)
      const finalQueue = detailTasks.sort((a, b) => (b.seeds || 0) - (a.seeds || 0)).slice(0, 45);

      await Promise.all(finalQueue.map(async item => {
        try {
          const res = await fetch(item.url, { headers: { "User-Agent": "Mozilla/5.0" } });
          const html = item.tracker === "NNMClub" ? new TextDecoder("windows-1251").decode(await res.arrayBuffer()) : await res.text();
          
          let poster = "";
          // Универсальный поиск картинки для Rutor, NNM, LePorno, XXXTor
          const posterM = html.match(/<(?:var|img)[^>]+(?:class="postImg" title="|src=")([^"]+)"/i) || 
                          html.match(/id="blobu">[\s\S]*?<img src="([^"]+)"/i) ||
                          html.match(/<img[^>]+src="([^"]+(?:jpe?g|png))"[^>]+class="postimg"/i);
          
          if (posterM) poster = posterM[1].startsWith('http') ? posterM[1] : (new URL(item.url).origin + posterM[1]);

          // Дособираем магниты для NNM и LePorno
          let magnet = item.magnet || "";
          if (item.tracker === "NNMClub") {
            const m = html.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"]*)"/i);
            magnet = m ? m[1].replace(/&amp;/g, '&') : "";
          } else if (item.tracker === "LePorno.de") {
            const fId = html.match(/download\/file\.php\?id=(\d+)/);
            magnet = fId ? `${new URL(item.url).origin}/download/file.php?id=${fId[1]}&magnet=1` : "";
          }

          // Дособираем размер и сиды если их не было
          const sizeM = html.match(/(?:Размер|Size|Größe):[\s\S]*?<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ГБ|МБ|КБ)/i);
          const seedsM = html.match(/seedmed"><b>(\d+)<\/b>/) || html.match(/class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b>/i);

          Results.push({
            Title: item.title,
            Seeders: item.seeds || (seedsM ? parseInt(seedsM[1]) : 0),
            Size: item.size || (sizeM ? parseSizeToBytes(sizeM[1], sizeM[2]) : 0),
            Tracker: item.tracker,
            MagnetUri: magnet,
            Link: item.url,
            Poster: poster
          });
        } catch (e) {}
      }));

    } catch (e) { console.error("Ошибка LeinAI:", e); }

    Results.sort((a, b) => b.Seeders - a.Seeders);
    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"], Count: Results.length });
  }
};

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  const u = unit.toUpperCase();
  const map = { 'TB': 4, 'ТБ': 4, 'GB': 3, 'ГБ': 3, 'MB': 2, 'МБ': 2, 'KB': 1, 'КБ': 1 };
  return Math.round(n * (1024 ** (map[u] || 0)));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
  });
}
