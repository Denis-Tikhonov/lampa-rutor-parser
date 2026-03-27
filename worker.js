export default {
  async fetch(request) {
    const url = new URL(request.url);

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
    if (!query) return jsonResponse({ Results: [], Indexers: [] });

    const encodedQuery = encodeURIComponent(query);
    const Results = [];
    const seen = new Set();

    try {
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://leporno.de/search.php"
          },
          body: new URLSearchParams({ 'keywords': query, 'terms': 'all', 'sr': 'topics', 'sf': 'all', 'submit': 'Search' }).toString()
        }).then(r => r.text()).catch(() => "")
      ]);

      // --- RUTOR (БЕЗ ИЗМЕНЕНИЙ) ---
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
              seen.add(hash);
              const size = b.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
              const seeds = b.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
              const peers = b.match(/<span class="red">[\s\S]*?&nbsp;(\d+)<\/span>/);
              Results.push({ Title: t[2].trim(), Seeders: seeds ? parseInt(seeds[1]) : 0, Peers: peers ? parseInt(peers[1]) : 0, Size: size ? parseSizeToBytes(size[1], size[2]) : 0, Tracker: "Rutor", MagnetUri: mag[1], Link: `https://rutor.info/torrent/${t[1]}`, PublishDate: new Date().toISOString() });
            }
          }
        }
      }

      // --- NNMCLUB (ИСПРАВЛЕНО: РАЗМЕР, СИДЫ, ПИРЫ) ---
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        await Promise.all(rows.slice(0, 15).map(async r => {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (t) {
            const res = await fetch(`https://nnmclub.to/forum/viewtopic.php?t=${t[1]}`).then(r => r.arrayBuffer());
            const th = new TextDecoder("windows-1251").decode(res);
            const mag = th.match(/href="(magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"]*)"/i);
            if (mag && !seen.has(mag[2].toLowerCase())) {
              seen.add(mag[2].toLowerCase());
              // Ищем размер, сиды и пиры внутри топика
              const sizeM = th.match(/Размер:[\s\S]*?<b>([\d.,]+)\s*(GB|MB|KB|ГБ|МБ|КБ)<\/b>/i);
              const seedsM = th.match(/seedmed"><b>(\d+)<\/b>/) || th.match(/Сиды:[\s\S]*?(\d+)/);
              const peersM = th.match(/leechmed"><b>(\d+)<\/b>/) || th.match(/Пиры:[\s\S]*?(\d+)/);

              Results.push({ 
                Title: t[2].trim(), 
                Seeders: seedsM ? parseInt(seedsM[1]) : 0, 
                Peers: peersM ? parseInt(peersM[1]) : 0, 
                Size: sizeM ? parseSizeToBytes(sizeM[1], sizeM[2]) : 0, 
                Tracker: "NNMClub", 
                MagnetUri: mag[1].replace(/&amp;/g, '&'), 
                Link: `https://nnmclub.to/forum/viewtopic.php?t=${t[1]}`,
                PublishDate: new Date().toISOString()
              });
            }
          }
        }));
      }

      // --- XXXTOR (БЕЗ ИЗМЕНЕНИЙ) ---
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of xtRows) {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        const mag = r.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
        if (t && mag) {
          const seeds = r.match(/class=["']green["'][^>]*>[\s\S]*?&nbsp;(\d+)/i);
          const size = r.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
          Results.push({ Title: t[2].trim(), Tracker: "XXXTor", MagnetUri: mag[1].replace(/&amp;/g, '&'), Seeders: seeds ? parseInt(seeds[1]) : 0, Peers: 0, Size: size ? parseSizeToBytes(size[1], size[2]) : 0, Link: `https://xxxtor.com/torrent/${t[1]}/` });
        }
      }

      // --- LEPORNO.DE (ИСПРАВЛЕНО: РАЗМЕР, БИТРЕЙТ, СИДЫ, ПИРЫ) ---
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
              const sizeM = h.match(/(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);
              const seedsM = h.match(/class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b>/i);
              const peersM = h.match(/class=["'][^"']*leech[^"']*["'][^>]*><b>(\d+)<\/b>/i);
              const bitrateM = h.match(/(\d+)\s*(kbps|kb\/s|mbps)/i);

              let finalTitle = item.title;
              if (bitrateM) finalTitle += ` [${bitrateM[0]}]`;

              Results.push({
                Title: finalTitle,
                Seeders: seedsM ? parseInt(seedsM[1]) : 0,
                Peers: peersM ? parseInt(peersM[1]) : 0,
                Size: sizeM ? parseSizeToBytes(sizeM[1], sizeM[2]) : 0,
                Tracker: "LePorno.de",
                MagnetUri: `https://leporno.de/download/file.php?id=${fileId[1]}&magnet=1`,
                Link: `https://leporno.de/viewtopic.php?t=${item.id}`,
                PublishDate: new Date().toISOString()
              });
            }
          } catch (e) {}
        }));
      }

    } catch (e) {}

    Results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));
    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"] });
  }
};

function parseSizeToBytes(num, unit) {
  if (!num) return 0;
  const n = parseFloat(num.replace(",", "."));
  const u = unit.toUpperCase();
  const map = { 'TB': 1024**4, 'ТБ': 1024**4, 'GB': 1024**3, 'ГБ': 1024**3, 'MB': 1024**2, 'МБ': 1024**2, 'KB': 1024, 'КБ': 1024 };
  return Math.round(n * (map[u] || 1));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
  });
}
