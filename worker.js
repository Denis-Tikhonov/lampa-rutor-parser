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
    
    const Results = [];
    const seen = new Set();
    const debug = { query, trackers: {} };

    try {
      // ===================================================
      // 1. ПЕРВИЧНЫЕ ЗАПРОСЫ
      // ===================================================
      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => ""),
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://leporno.de/search.php"
          },
          body: new URLSearchParams({ 
            'keywords': query, 'terms': 'all', 'sr': 'topics', 'sf': 'titleonly', 'submit': 'Search' 
          }).toString()
        }).then(r => r.text()).catch(() => "")
      ]);

      // ===================================================
      // 2. ПАРСИНГ RUTOR (БЕЗ ИЗМЕНЕНИЙ)
      // ===================================================
      for (const html of rutorPages) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let m;
        while ((m = rowRegex.exec(html)) !== null) {
          const b = m[1];
          const t = b.match(/href="\/torrent\/(\d+)\/[^"]*">([^<]+)<\/a>/);
          if (!t) continue;
          const mag = b.match(/href="(magnet:\?[^"]+)"/);
          if (!mag) continue;
          const hash = (mag[1].match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
          if (seen.has(hash)) continue; seen.add(hash);
          const sInfo = b.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
          const sd = b.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
          const lc = b.match(/<span class="red">[\s\S]*?&nbsp;(\d+)<\/span>/);
          Results.push({
            Title: t[2].trim(), Seeders: sd ? parseInt(sd[1]) : 0, Peers: lc ? parseInt(lc[1]) : 0,
            Size: sInfo ? parseSizeToBytes(sInfo[1], sInfo[2]) : 0, Tracker: "Rutor",
            MagnetUri: mag[1].replace(/&amp;/g, '&'), Link: `https://rutor.info/torrent/${t[1]}`,
            PublishDate: new Date().toISOString()
          });
        }
      }

      // ===================================================
      // 3. ПАРСИНГ NNMCLUB (ИСПРАВЛЕНО)
      // ===================================================
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        const nnmItems = [];

        for (const r of rows) {
          // Парсим ID и Название
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"[^>]*><b>([^<]+)<\/b>/);
          if (t) {
            const id = t[1];
            const title = t[2].trim();

            // Извлекаем точный размер в байтах из тега <u>
            const sizeMatch = r.match(/<u>(\d+)<\/u>/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;

            // Извлекаем сидов (Seeders)
            const seedsMatch = r.match(/class="seedmed"><b>(\d+)<\/b>/);
            const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;

            // Извлекаем пиров (Leechers)
            const peersMatch = r.match(/class="leechmed"><b>(\d+)<\/b>/);
            const peers = peersMatch ? parseInt(peersMatch[1]) : 0;

            nnmItems.push({ id, title, size, seeds, peers });
          }
        }

        // Выполняем дозапрос только для получения Magnet-ссылок
        await Promise.all(nnmItems.slice(0, 15).map(async it => {
          try {
            const res = await fetch(`https://nnmclub.to/forum/viewtopic.php?t=${it.id}`).then(r => r.arrayBuffer());
            const th = new TextDecoder("windows-1251").decode(res);
            const magnet = th.match(/href="(magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"]*)"/i);

            if (magnet) {
              const hash = magnet[2].toLowerCase();
              if (!seen.has(hash)) {
                seen.add(hash);
                
                Results.push({
                  Title: it.title,
                  Seeders: it.seeds,
                  Peers: it.peers,
                  Size: it.size,
                  Tracker: "NNMClub",
                  MagnetUri: magnet[1].replace(/&amp;/g, '&'),
                  Link: `https://nnmclub.to/forum/viewtopic.php?t=${it.id}`,
                  PublishDate: new Date().toISOString()
                });
              }
            }
          } catch (e) {}
        }));
      }
     
      // ===================================================
      // 4. ПАРСИНГ XXXTOR (БЕЗ ИЗМЕНЕНИЙ)
      // ===================================================
      const xtRows = xxxtorHtml.match(/<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];
      for (const r of xtRows) {
        const t = r.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
        if (!t) continue;
        const mag = r.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
        if (mag && !seen.has(mag[2].toLowerCase())) {
          seen.add(mag[2].toLowerCase());
          const sz = r.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
          const sd = r.match(/class=["']green["'][^>]*>[\s\S]*?&nbsp;(\d+)/i);
          Results.push({
            Title: t[2].trim(), Seeders: sd ? parseInt(sd[1]) : 0, Peers: 0,
            Size: sz ? parseSizeToBytes(sz[1], sz[2]) : 0,
            Tracker: "XXXTor", MagnetUri: mag[1].replace(/&amp;/g, '&'),
            Link: `https://xxxtor.com/torrent/${t[1]}/`,
            PublishDate: new Date().toISOString()
          });
        }
      }

// ===================================================
// 5. ПАРСИНГ LEPORNO.DE (ПЕРЕРАБОТАННЫЙ ПО АНАЛОГИИ С 3 РАЗДЕЛОМ)
// ===================================================
if (lepornoHtml) {
  try {
    // Основной контейнер с торрентами
    const tableMatch = lepornoHtml.match(/<table[^>]*class=["']forumline["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      console.log('[LePorno] Не найдена основная таблица с торрентами');
      return;
    }

    const tableHtml = tableMatch[1];
    const rows = [...tableHtml.matchAll(/<tr\s+(?:class=["'][^"']*["']\s+)?valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi)];

    console.log(`[LePorno] Найдено строк: ${rows.length}`);

    const lepItems = rows.slice(1).map(row => { // Пропускаем заголовок (slice(1))
      const html = row[1];
      const item = {};

      // 1. ID топика (аналогично 3 разделу)
      const topicLink = (html.match(/href=["'](viewtopic\.php\?t=(\d+)(?:&amp;[^"']*)?)["']/i) || [])[1];
      if (!topicLink) {
        console.log('[LePorno] Не найдена ссылка на топик');
        return null;
      }
      item.topicId = topicLink.match(/t=(\d+)/)[1];
      item.link = `https://leporno.de/${topicLink}`;

      // 2. Название (аналогично 3 разделу)
      item.title = (html.match(/class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1]
        ?.replace(/<[^>]+>/g, '')
        ?.replace(/&amp;/g, '&')
        ?.replace(/&quot;/g, '"')
        ?.trim();
      if (!item.title) {
        console.log(`[LePorno] Не найден title для топика ${item.topicId}`);
        return null;
      }

      // 3. Магнет-ссылка (аналогично 3 разделу)
      const magnetMatch = html.match(/href=["'](\.\/download\/file\.php\?id=\d+[^"']*magnet=1[^"']*)["']/i);
      item.magnetUrl = magnetMatch ? magnetMatch[1].replace(/^\./, '') : null;
      if (!item.magnetUrl) {
        console.log(`[LePorno] Не найдена magnet-ссылка для топика ${item.topicId}`);
        return null;
      }

      // 4. Размер файла (улучшенный парсинг)
      const sizeMatch = html.match(/<td[^>]*>\s*Размер:\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*(GB|MB|KB|ГБ|МБ|КБ)\s*<\/td>/i);
      if (sizeMatch) {
        const value = parseFloat(sizeMatch[1].replace(',', '.'));
        const unit = sizeMatch[2].toUpperCase();
        const multipliers = { GB: 1e9, ГБ: 1e9, MB: 1e6, МБ: 1e6, KB: 1e3, КБ: 1e3 };
        item.sizeBytes = value * (multipliers[unit] || 1);
        console.log(`[LePorno] Размер: ${value} ${unit} = ${item.sizeBytes} байт`);
      } else {
        console.log(`[LePorno] Не найден размер для топика ${item.topicId}`);
        item.sizeBytes = 0;
      }

      // 5. Битрейт (аналогично 3 разделу)
      const bitrateMatch = html.match(/<td[^>]*>\s*Битрейт:\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*(kbps|кбит\/с|Мбит\/с)\s*<\/td>/i);
      if (bitrateMatch) {
        item.bitrate = parseFloat(bitrateMatch[1].replace(',', '.'));
        if (bitrateMatch[2].toLowerCase().includes('мбит')) {
          item.bitrate *= 1000;
        }
      }

      // 6. Сиды и пиры (улучшенный парсинг)
      const seedMatch = html.match(/<td[^>]*class=["']seed["'][^>]*>\s*(\d+)\s*<\/td>/i);
      const leechMatch = html.match(/<td[^>]*class=["']leech["'][^>]*>\s*(\d+)\s*<\/td>/i);

      item.seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
      item.peers = leechMatch ? parseInt(leechMatch[1]) : 0;

      // Резервный парсинг сидов/пиров (если основной не сработал)
      if (item.seeders === 0 && item.peers === 0) {
        const statsMatch = html.match(/<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>/i);
        if (statsMatch) {
          item.seeders = parseInt(statsMatch[1]);
          item.peers = parseInt(statsMatch[2]);
          console.log(`[LePorno] Использован резервный парсинг сидов/пиров: ${item.seeders}/${item.peers}`);
        }
      }

      return item;
    }).filter(Boolean);

    // Обработка через общую функцию getInfoHash
    for (const item of lepItems) {
      try {
        console.log(`[LePorno] Обработка топика ${item.topicId}: ${item.title}`);

        const magnetUri = await getInfoHash(`https://leporno.de${item.magnetUrl}`, {
          referer: item.link,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        });

        if (magnetUri) {
          const hash = (magnetUri.match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
          if (hash && !seen.has(hash)) {
            seen.add(hash);
            Results.push({
              Title: item.title,
              Seeders: item.seeders,
              Peers: item.peers,
              Size: item.sizeBytes,
              Bitrate: item.bitrate,
              Tracker: "LePorno.de",
              MagnetUri: magnetUri,
              Link: item.link,
              PublishDate: new Date().toISOString()
            });
            console.log(`[LePorno] ✅ Успешно добавлен: ${item.title}`);
          } else {
            console.log(`[LePorno] ⚠️ Торрент уже существует или не найден hash`);
          }
        } else {
          console.log(`[LePorno] ❌ Не удалось получить magnet URI для ${item.title}`);
        }
      } catch (e) {
        console.error(`[LePorno] Ошибка обработки топика ${item.topicId}:`, e.message);
        console.log('[LePorno] HTML строки:', row[1].substring(0, 500));
      }
    }

  } catch (e) {
    console.error('[LePorno] Критическая ошибка:', e.message);
  }
}



// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function getInfoHash(buffer) {
  try {
    const uint8 = new Uint8Array(buffer);
    const decoder = new TextDecoder('latin1');
    const data = decoder.decode(uint8);
    const infoKey = "4:info";
    const infoIndex = data.indexOf(infoKey);
    if (infoIndex === -1) return null;
    const infoStart = infoIndex + infoKey.length;
    let pos = infoStart;
    let depth = 0;
    if (data[pos] !== 'd') return null;
    while (pos < data.length) {
      const char = data[pos];
      if (char === 'd' || char === 'l') depth++;
      else if (char === 'e') {
        depth--;
        if (depth === 0) break;
      } else if (!isNaN(parseInt(char))) {
        const colonIndex = data.indexOf(':', pos);
        const len = parseInt(data.substring(pos, colonIndex));
        pos = colonIndex + len;
      }
      pos++;
    }
    const infoEnd = pos + 1;
    const infoBytes = uint8.slice(infoStart, infoEnd);
    const hashBuffer = await crypto.subtle.digest('SHA-1', infoBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

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
