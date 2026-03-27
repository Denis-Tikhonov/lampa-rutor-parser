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
      // 1. ЗАПРОСЫ (ПАРАЛЛЕЛЬНО)
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        // Rutor
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        // NNM (Windows-1251)
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        // XXXTor
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        // LePorno (POST)
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

      // --- ПАРСИНГ RUTOR ---
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
              Results.push({ Title: t[2].trim(), Seeders: seeds ? parseInt(seeds[1]) : 0, Size: size ? parseSizeToBytes(size[1], size[2]) : 0, Tracker: "Rutor", MagnetUri: mag[1], Link: `https://rutor.info/torrent/${t[1]}` });
            }
          }
        }
      }

      // --- ПАРСИНГ NNMCLUB ---
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        await Promise.all(rows.slice(0, 10).map(async r => {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (t) {
            const res = await fetch(`https://nnmclub.to/forum/viewtopic.php?t=${t[1]}`).then(r => r.arrayBuffer());
            const th = new TextDecoder("windows-1251").decode(res);
            const mag = th.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"]*)"/i);
            if (mag) Results.push({ Title: t[2].trim(), Seeders: 0, Tracker: "NNMClub", MagnetUri: mag[1], Link: `https://nnmclub.to/forum/viewtopic.php?t=${t[1]}` });
          }
        }));
      }

      // --- ПАРСИНГ XXXTOR ---
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of xtRows) {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        const mag = r.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
        if (t && mag) Results.push({ Title: t[2].trim(), Tracker: "XXXTor", MagnetUri: mag[1].replace(/&amp;/g, '&'), Seeders: 0, Link: `https://xxxtor.com/torrent/${t[1]}/` });
      }

      // ===================================================
      // ПАРСИНГ LEPORNO.DE (С ВЫЧИСЛЕНИЕМ HASH)
      // ===================================================
      if (lepornoHtml) {
        const topicRegex = /viewtopic\.php\?[^"']*t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/gi;
        const lepItems = [];
        let tm;
        while ((tm = topicRegex.exec(lepornoHtml)) !== null) {
          lepItems.push({ id: tm[1], title: tm[2].replace(/<[^>]+>/g, '').trim() });
          if (lepItems.length >= 10) break;
        }

        await Promise.all(lepItems.map(async item => {
          try {
            const topicRes = await fetch(`https://leporno.de/viewtopic.php?t=${item.id}`);
            const topicHtml = await topicRes.text();
            
            const fileIdMatch = topicHtml.match(/download\/file\.php\?id=(\d+)/);
            if (fileIdMatch) {
              const fileId = fileIdMatch[1];
              // Скачиваем сам торрент-файл
              const torrentRes = await fetch(`https://leporno.de/download/file.php?id=${fileId}`);
              const torrentBuffer = await torrentRes.arrayBuffer();
              
              // Вычисляем инфо-хеш раздачи
              const hash = await getInfoHash(torrentBuffer);
              
              if (hash) {
                const seeds = topicHtml.match(/class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b>/i);
                const size = topicHtml.match(/(?:Размер|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);

                Results.push({
                  Title: item.title,
                  Seeders: seeds ? parseInt(seeds[1]) : 0,
                  Size: size ? parseSizeToBytes(size[1], size[2]) : 0,
                  Tracker: "LePorno.de",
                  MagnetUri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.title)}&tr=udp://tracker.opentrackr.org:1337/announce`,
                  Link: `https://leporno.de/viewtopic.php?t=${item.id}`
                });
              }
            }
          } catch (e) { console.error("LePorno error:", e); }
        }));
      }

    } catch (e) { console.error("Main error:", e); }

    Results.sort((a, b) => b.Seeders - a.Seeders);
    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"] });
  }
};

// --- ФУНКЦИЯ ДЛЯ ВЫЧИСЛЕНИЯ INFO-HASH ИЗ .TORRENT ---
async function getInfoHash(buffer) {
  try {
    const uint8 = new Uint8Array(buffer);
    const decoder = new TextDecoder('latin1');
    const data = decoder.decode(uint8);
    
    // Ищем начало слова "4:info" в Bencode
    const infoKey = "4:info";
    const infoIndex = data.indexOf(infoKey);
    if (infoIndex === -1) return null;

    // Начало словаря info сразу после "4:info"
    const infoStart = infoIndex + infoKey.length;
    
    // Нам нужно найти конец словаря info. 
    // В Bencode словарь заканчивается на 'e', но внутри могут быть другие 'e'.
    // Реализуем простой счетчик вложенности.
    let pos = infoStart;
    let depth = 0;
    
    // Первый символ должен быть 'd'
    if (data[pos] !== 'd') return null;

    while (pos < data.length) {
      const char = data[pos];
      if (char === 'd' || char === 'l') depth++;
      else if (char === 'e') {
        depth--;
        if (depth === 0) break;
      } else if (!isNaN(parseInt(char))) {
        // Пропускаем строки типа "5:hello"
        const colonIndex = data.indexOf(':', pos);
        const len = parseInt(data.substring(pos, colonIndex));
        pos = colonIndex + len;
      }
      pos++;
    }

    const infoEnd = pos + 1;
    const infoBytes = uint8.slice(infoStart, infoEnd);
    
    // Хешируем блок info через SHA-1
    const hashBuffer = await crypto.subtle.digest('SHA-1', infoBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

function parseSizeToBytes(num, unit) {
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
