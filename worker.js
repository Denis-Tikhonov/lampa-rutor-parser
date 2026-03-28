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
// 1. ПЕРВИЧНЫЕ ЗАПРОСЫ (ИСПРАВЛЕННЫЙ)
// ===================================================
const encodedQuery = encodeURIComponent(query);
let pirateHtml = "";
let rutrackerHtml = "";
let nnmHtml = "";
let lepornoHtml = "";
let tfileHtml = "";

// Запросы выполняются параллельно
await Promise.all([
  // PirateBay
  (async () => {
    pirateHtml = await fetch(`https://apibay.org/q.php?q=${encodedQuery}&cat=0`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }).then(r => r.text()).catch(() => "");
  })(),
  
  // Rutracker
  (async () => {
    rutrackerHtml = await fetch(`https://rutracker.org/forum/tracker.php?nm=${encodedQuery}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": "bb_session=0"
      }
    }).then(r => r.text()).catch(() => "");
  })(),
  
  // NNM-Club
  (async () => {
    nnmHtml = await fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": "bb_session=0"
      }
    }).then(r => r.text()).catch(() => "");
  })(),
  
  // LePorno.de (ИСПРАВЛЕННЫЙ ЗАПРОС)
  (async () => {
    try {
      // Используем параметры поиска как на реальном сайте
      const searchUrl = `https://leporno.de/search.php?tracker_search=torrent&keywords=${encodedQuery}&terms=all&author=&sc=1&sf=titleonly&sk=t&sd=d&sr=topics&st=0&ch=300&t=0&submit=%D0%9F%D0%BE%D0%B8%D1%81%D0%BA`;
      
      lepornoHtml = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "Referer": "https://leporno.de/search.php",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Cache-Control": "max-age=0"
        },
        // Добавляем таймаут и обработку редиректов
        timeout: 10000,
        redirect: "follow"
      }).then(async r => {
        if (r.ok) {
          return await r.text();
        } else {
          console.error(`LePorno request failed: ${r.status} ${r.statusText}`);
          return "";
        }
      }).catch(e => {
        console.error(`LePorno fetch error: ${e.message}`);
        return "";
      });
      
      // Проверяем, что получили HTML с результатами
      if (lepornoHtml && !lepornoHtml.includes('class="topictitle"')) {
        console.warn("LePorno response doesn't contain expected structure");
        // Пробуем альтернативный запрос без некоторых параметров
        const altUrl = `https://leporno.de/search.php?keywords=${encodedQuery}&terms=all&sr=topics&submit=%D0%9F%D0%BE%D0%B8%D1%81%D0%BA`;
        lepornoHtml = await fetch(altUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        }).then(r => r.text()).catch(() => "");
      }
    } catch (e) {
      console.error(`LePorno request failed: ${e.message}`);
      lepornoHtml = "";
    }
  })(),
  
  // TFile
  (async () => {
    tfileHtml = await fetch(`https://tfile.co/forum/tracker.php?nm=${encodedQuery}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": "bb_session=0"
      }
    }).then(r => r.text()).catch(() => "");
  })()
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
// 5. ПАРСИНГ LEPORNO.DE (ИСПРАВЛЕННЫЙ)
// ===================================================
if (lepornoHtml) {
  const rowRegex = /<tr\s+valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi;
  const lepItems = [];
  let rm;
  
  while ((rm = rowRegex.exec(lepornoHtml)) !== null) {
    const row = rm[1];
    
    // Извлекаем ID торрента и название
    const topicMatch = row.match(/href=["']\.\/viewtopic\.php\?(?:[^"']*&)?t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([^<]+)<\/a>/i);
    if (!topicMatch) continue;
    
    const torrentId = topicMatch[1];
    const title = topicMatch[2].trim();
    
    // Извлекаем ID файла для скачивания
    const fileIdMatch = row.match(/href=["']\.\/download\/file\.php\?id=(\d+)["']/i);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;
    
    // Извлекаем размер (может быть в разных форматах) - ИСПРАВЛЕН СИНТАКСИС
    const sizeMatch = row.match(/(?:Размер|Size):\s*<b>([\d.,]+)&nbsp;([TGMK]Б|[TGMK]B)/i);
    let size = 0;
    if (sizeMatch) {
      size = parseSizeToBytes(sizeMatch[1], sizeMatch[2]);
    }
    
    // Извлекаем сиды и личи - ИСПРАВЛЕН СИНТАКСИС
    const seedsMatch = row.match(/<span class=["']my_tt seed["'][^>]*><b>(\d+)<\/b><\/span>/i);
    const leechMatch = row.match(/<span class=["']my_tt leech["'][^>]*><b>(\d+)<\/b><\/span>/i);
    
    // Извлекаем здоровье (health) - ИСПРАВЛЕН СИНТАКСИС
    const healthMatch = row.match(/(?:Здоровье|Health):\s*<b>(\d+)<\/b>/i);
    
    lepItems.push({
      id: torrentId,
      fileId: fileId,
      title: title,
      size: size,
      seeds: seedsMatch ? parseInt(seedsMatch[1]) : 0,
      leech: leechMatch ? parseInt(leechMatch[1]) : 0,
      health: healthMatch ? parseInt(healthMatch[1]) : 0
    });
    
    if (lepItems.length >= 15) break;
  }
  
  // Обрабатываем каждый найденный торрент
  await Promise.all(lepItems.map(async item => {
    try {
      if (!item.fileId) return;
      
      // Получаем хеш из торрент-файла
      const torRes = await fetch(`https://leporno.de/download/file.php?id=${item.fileId}`);
      const torBuf = await torRes.arrayBuffer();
      const hash = await getInfoHash(torBuf);
      
      if (hash && !seen.has(hash)) {
        seen.add(hash);
        
        // Дополнительно получаем детали со страницы торрента для уточнения данных
        let detailedTitle = item.title;
        let bitrate = null;
        
        try {
          const pageRes = await fetch(`https://leporno.de/viewtopic.php?t=${item.id}`);
          const pageHtml = await pageRes.text();
          
          // Ищем битрейт на странице (может быть в разных местах) - ИСПРАВЛЕН СИНТАКСИС
          const bitrateMatch = pageHtml.match(/(\d+)\s*(kbps|kb\/s|mbps|кбит\/с)/i);
          if (bitrateMatch) {
            bitrate = bitrateMatch[0];
            detailedTitle = `${item.title} [${bitrate}]`;
          }
          
          // Уточняем размер со страницы (если есть более точные данные) - ИСПРАВЛЕН СИНТАКСИС
          const detailedSizeMatch = pageHtml.match(/(?:Размер|Size|Größe):\s*<b>([\d.,]+)&nbsp;([TGMK]Б|[TGMK]B)/i);
          if (detailedSizeMatch) {
            item.size = parseSizeToBytes(detailedSizeMatch[1], detailedSizeMatch[2]);
          }
          
          // Уточняем сиды и личи со страницы - ИСПРАВЛЕН СИНТАКСИС
          const detailedSeedsMatch = pageHtml.match(/<span class=["']my_tt seed["'][^>]*><b>(\d+)<\/b><\/span>/i);
          const detailedLeechMatch = pageHtml.match(/<span class=["']my_tt leech["'][^>]*><b>(\d+)<\/b><\/span>/i);
          
          if (detailedSeedsMatch) item.seeds = parseInt(detailedSeedsMatch[1]);
          if (detailedLeechMatch) item.leech = parseInt(detailedLeechMatch[1]);
          
        } catch (e) {
          // Если не удалось получить детали, используем данные из поиска
          console.error(`Error fetching details for ${item.id}:`, e.message);
        }
        
        // Разделяем название на русское и английское (если есть разделитель)
        let titleRu = item.title;
        let titleEn = "";
        const titleParts = item.title.split(/[\/|]/);
        if (titleParts.length > 1) {
          titleRu = titleParts[0].trim();
          titleEn = titleParts.slice(1).join(' ').trim();
        }
        
        Results.push({
          Title: detailedTitle,
          TitleRu: titleRu,
          TitleEn: titleEn,
          Seeders: item.seeds,
          Peers: item.leech,
          Size: item.size,
          Bitrate: bitrate,
          Health: item.health,
          Tracker: "LePorno.de",
          MagnetUri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(item.title)}`,
          TorrentLink: `https://leporno.de/download/file.php?id=${item.fileId}`,
          Link: `https://leporno.de/viewtopic.php?t=${item.id}`,
          PublishDate: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error(`Error processing LePorno item ${item.id}:`, e.message);
    }
  }));
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
} catch (e) {
      // обработка ошибок главного try
    }
    
    return jsonResponse({ Results, Indexers: [], Message: "OK" });
  }
}
