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

    // ===================================================
    // НАСТРОЙКИ ФИЛЬТРАЦИИ
    // ===================================================
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);

    const videoKeywords = /\b(mkv|mp4|avi|mov|wmv|ts|m2ts|remux|bluray|blu-ray|bdrip|webrip|webdl|web-dl|hdtv|hdrip|dvdrip|xvid|x264|x265|hevc|h264|h\.264|h265|h\.265|1080p|720p|2160p|4k|uhd|av1)\b/i;

    const Results = [];
    const seen = new Set();
    const debug = {
      query: query,
      trackers: {}
    };

    try {
      // ===================================================
      // ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ
      // ===================================================
      const RUTOR_CATEGORIES = [1, 2, 4, 5, 10];
      const encodedQuery = encodeURIComponent(query);

      const [rutorPages, nnmBuffer, xxxtorHtml, lepornoHtml] = await Promise.all([
        // Rutor
        Promise.all(
          RUTOR_CATEGORIES.map(cat =>
            fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, {
              headers: { "User-Agent": "Mozilla/5.0" }
            }).then(r => r.text()).catch(() => "")
          )
        ),
        // NNMClub (Windows-1251)
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        }).then(r => r.arrayBuffer()).catch(() => null),
        // XXXTor
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://xxxtor.com/"
          }
        }).then(r => r.text()).catch(() => ""),
        // LePorno.de
        fetch(`https://leporno.de/search.php?search=${encodedQuery}`, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8,ru;q=0.7",
            "Referer": "https://leporno.de/"
          }
        }).then(async r => {
          const status = r.status;
          const text = await r.text();
          debug.trackers.leporno = {
            status: status,
            htmlLength: text.length,
            url: `https://leporno.de/search.php?search=${encodedQuery}`
          };
          return text;
        }).catch(err => {
          console.error("LePorno fetch error:", err);
          debug.trackers.leporno = { error: err.message };
          return "";
        })
      ]);

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

          const id = titleMatch[1];
          const title = titleMatch[2].trim();
          if (seen.has(`rutor_${id}`) || !passFilters(title, queryTokens, videoKeywords)) continue;
          seen.add(`rutor_${id}`);

          const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/);
          const hash = magnetMatch ? (magnetMatch[1].match(/btih:([a-fA-F0-9]{40})/i) || [])[1] : "";
          if (!hash) continue;

          const sizeMatch = block.match(/([\d.,]+)&nbsp;(GB|MB|KB)/i);
          const seedMatch = block.match(/<span class="green">[\s\S]*?&nbsp;(\d+)<\/span>/);
          const peerMatch = block.match(/<span class="red">[\s\S]*?&nbsp;(\d+)<\/span>/);

          Results.push({
            Title: title,
            Seeders: seedMatch ? parseInt(seedMatch[1]) : 0,
            Peers: peerMatch ? parseInt(peerMatch[1]) : 0,
            Size: sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0,
            Tracker: "Rutor",
            MagnetUri: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`,
            Link: `https://rutor.info/torrent/${id}`,
            PublishDate: new Date().toISOString(),
          });
        }
      }

      // ===================================================
      // ПАРСИНГ NNMCLUB
      // ===================================================
      if (nnmBuffer) {
        const nnmHtml = new TextDecoder("windows-1251").decode(nnmBuffer);
        const nnmItems = [];
        const nnmRowRegex = /<tr class="p?row[12]">([\s\S]*?)<\/tr>/g;
        let nnmRow;

        while ((nnmRow = nnmRowRegex.exec(nnmHtml)) !== null) {
          const block = nnmRow[1];
          const titleMatch = block.match(/href="viewtopic\.php\?t=(\d+)"><b>([^<]+)<\/b>/);
          if (!titleMatch) continue;

          const id = titleMatch[1];
          const title = titleMatch[2].trim();
          if (seen.has(`nnm_${id}`) || !passFilters(title, queryTokens, videoKeywords)) continue;
          seen.add(`nnm_${id}`);

          const sizeMatch = block.match(/<u>\d+<\/u>\s*([\d.,]+)\s*(GB|MB|KB)/i);
          const seedMatch = block.match(/class="seedmed"><b>(\d+)<\/b>/);
          const peerMatch = block.match(/class="leechmed"><b>(\d+)<\/b>/);

          nnmItems.push({
            id, title,
            size: sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0,
            seeders: seedMatch ? parseInt(seedMatch[1]) : 0,
            peers: peerMatch ? parseInt(peerMatch[1]) : 0,
          });
        }

        const nnmMagnets = await Promise.all(
          nnmItems.map(item =>
            fetch(`https://nnmclub.to/forum/viewtopic.php?t=${item.id}`, { headers: { "User-Agent": "Mozilla/5.0" } })
              .then(r => r.arrayBuffer())
              .then(buf => {
                const h = new TextDecoder("windows-1251").decode(buf);
                const m = h.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]+[^"]*)"/i);
                return m ? m[1] : "";
              }).catch(() => "")
          )
        );

        nnmItems.forEach((item, i) => {
          if (nnmMagnets[i]) {
            Results.push({
              Title: item.title,
              Seeders: item.seeders,
              Peers: item.peers,
              Size: item.size,
              Tracker: "NNMClub",
              MagnetUri: nnmMagnets[i],
              Link: `https://nnmclub.to/forum/viewtopic.php?t=${item.id}`,
              PublishDate: new Date().toISOString(),
            });
          }
        });
      }

      // ===================================================
      // ПАРСИНГ XXXTor
      // ===================================================
      if (xxxtorHtml && xxxtorHtml.length > 100) {
        console.log("XXXTor HTML length:", xxxtorHtml.length);
        
        let xxxtorCount = 0;
        const rowRegex = /<tr\s+class=["']gai["'][^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        
        while ((rowMatch = rowRegex.exec(xxxtorHtml)) !== null) {
          const row = rowMatch[1];
          
          const titleLinkMatch = row.match(/<a\s+href=["']\/torrent\/(\d+)\/["'][^>]*>([^<]+)<\/a>/i);
          if (!titleLinkMatch) continue;
          
          const id = titleLinkMatch[1];
          let title = titleLinkMatch[2].trim();
          
          title = title.replace(/&amp;/g, '&')
                      .replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
          
          if (seen.has(`xxxtor_${id}`)) continue;
          seen.add(`xxxtor_${id}`);
          
          const magnetMatch = row.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
          const magnet = magnetMatch ? magnetMatch[1].replace(/&amp;/g, '&') : "";
          const hash = magnetMatch ? magnetMatch[2].toLowerCase() : "";
          
          const sizeMatch = row.match(/<td\s+align=["']right["'][^>]*>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB)/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          const seedMatch = row.match(/<span\s+class=["']green["'][^>]*>[\s\S]*?&nbsp;(\d+)<\/span>/i);
          const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
          
          const peerMatch = row.match(/<span\s+class=["']red["'][^>]*>&nbsp;(\d+)<\/span>/i);
          const peers = peerMatch ? parseInt(peerMatch[1]) : 0;
          
          const dateMatch = row.match(/<td>(\d+\s+\w+\s+\d+)<\/td>/i);
          const dateStr = dateMatch ? dateMatch[1] : "";
          
          xxxtorCount++;
          
          Results.push({
            Title: title,
            Seeders: seeders,
            Peers: peers,
            Size: size,
            Tracker: "XXXTor",
            MagnetUri: magnet || (hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&tr=udp://tracker.opentrackr.org:1337/announce` : ""),
            Link: `https://xxxtor.com/torrent/${id}/`,
            PublishDate: parseXXXTorDate(dateStr),
          });
        }

        console.log(`XXXTor: parsed ${xxxtorCount} torrents`);
      }

      // ===================================================
      // ПАРСИНГ LePorno.de - УЛУЧШЕННЫЙ С ЛОГИРОВАНИЕМ
      // ===================================================
      if (lepornoHtml && lepornoHtml.length > 100) {
        console.log("LePorno.de HTML length:", lepornoHtml.length);
        
        let lepornoCount = 0;
        const lepornoItems = [];

        // Сохраняем первые 3000 символов для отладки
        debug.trackers.leporno.htmlPreview = lepornoHtml.substring(0, 3000);

        // СТРАТЕГИЯ 1: Поиск <tr valign="middle">
        let rowRegex = /<tr\s+valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        let foundRows = 0;
        
        while ((rowMatch = rowRegex.exec(lepornoHtml)) !== null) {
          foundRows++;
          const row = rowMatch[1];
          
          // Проверяем наличие download/file.php
          if (!row.includes('download/file.php')) continue;
          
          // Извлекаем ID файла
          const downloadMatch = row.match(/download\/file\.php\?id=(\d+)/);
          if (!downloadMatch) continue;
          
          const fileId = downloadMatch[1];
          
          // Извлекаем topic ID
          const topicMatch = row.match(/viewtopic\.php\?[^"']*[&?]t=(\d+)/);
          if (!topicMatch) continue;
          
          const topicId = topicMatch[1];
          
          if (seen.has(`leporno_${topicId}`)) continue;
          seen.add(`leporno_${topicId}`);
          
          // Извлекаем название
          const titleMatch = row.match(/<a\s+href=["'][^"']*viewtopic\.php[^"']*["']\s+class=["']topictitle["'][^>]*>([^<]+)<\/a>/i);
          if (!titleMatch) {
            console.log(`LePorno: topic ${topicId} - no title found`);
            continue;
          }
          
          let title = titleMatch[1].trim();
          title = title.replace(/&amp;/g, '&')
                      .replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
          
          // Извлекаем размер (поддержка разных форматов)
          let size = 0;
          const sizePatterns = [
            /(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i,
            /<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)<\/b>/i,
            /([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i
          ];
          
          for (const pattern of sizePatterns) {
            const sizeMatch = row.match(pattern);
            if (sizeMatch) {
              size = parseSizeToBytes(sizeMatch[1], translateUnit(sizeMatch[2]));
              break;
            }
          }
          
          // Извлекаем сиды
          const seedPatterns = [
            /<span\s+class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i,
            /<span\s+class=["']my_tt\s+seed["'][^>]*><b>(\d+)<\/b>/i,
            /seed[^>]*>(\d+)/i
          ];
          
          let seeders = 0;
          for (const pattern of seedPatterns) {
            const seedMatch = row.match(pattern);
            if (seedMatch) {
              seeders = parseInt(seedMatch[1]);
              break;
            }
          }
          
          // Извлекаем пиры
          const peerPatterns = [
            /<span\s+class=["'][^"']*leech[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i,
            /<span\s+class=["']my_tt\s+leech["'][^>]*><b>(\d+)<\/b>/i,
            /leech[^>]*>(\d+)/i
          ];
          
          let peers = 0;
          for (const pattern of peerPatterns) {
            const peerMatch = row.match(pattern);
            if (peerMatch) {
              peers = parseInt(peerMatch[1]);
              break;
            }
          }
          
          // Извлекаем дату
          const datePatterns = [
            /<p\s+class=["']topicdetails["'][^>]*>(\d+\s+\w+\s+\d+,\s+\d+:\d+)<\/p>/i,
            /(\d+\s+\w+\s+\d+,\s+\d+:\d+)/i,
            /(\d+\.\d+\.\d+,\s+\d+:\d+)/i
          ];
          
          let dateStr = "";
          for (const pattern of datePatterns) {
            const dateMatch = row.match(pattern);
            if (dateMatch) {
              dateStr = dateMatch[1];
              break;
            }
          }
          
          lepornoItems.push({
            fileId,
            topicId,
            title,
            size,
            seeders,
            peers,
            dateStr
          });
          
          lepornoCount++;
          
          console.log(`LePorno: parsed topic ${topicId} - "${title.substring(0, 50)}..." S:${seeders} P:${peers} Size:${size}`);
        }

        debug.trackers.leporno.foundRows = foundRows;
        debug.trackers.leporno.parsedCount = lepornoCount;

        console.log(`LePorno.de: found ${foundRows} rows, parsed ${lepornoCount} torrents`);

        // СТРАТЕГИЯ 2: Если ничего не нашли, пробуем альтернативный формат
        if (lepornoCount === 0) {
          console.log("LePorno: trying alternative parsing...");
          
          // Ищем любые строки таблицы с торрентами
          rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          
          while ((rowMatch = rowRegex.exec(lepornoHtml)) !== null) {
            const row = rowMatch[1];
            
            if (!row.includes('download/file.php') || !row.includes('viewtopic.php')) continue;
            
            const downloadMatch = row.match(/download\/file\.php\?id=(\d+)/);
            const topicMatch = row.match(/viewtopic\.php\?[^"']*[&?]t=(\d+)/);
            
            if (!downloadMatch || !topicMatch) continue;
            
            const fileId = downloadMatch[1];
            const topicId = topicMatch[1];
            
            if (seen.has(`leporno_${topicId}`)) continue;
            seen.add(`leporno_${topicId}`);
            
            const titleMatch = row.match(/<a[^>]*>([^<]+)<\/a>/i);
            const title = titleMatch ? titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"') : `Torrent ${topicId}`;
            
            lepornoItems.push({
              fileId,
              topicId,
              title,
              size: 0,
              seeders: 0,
              peers: 0,
              dateStr: ""
            });
            
            lepornoCount++;
          }
          
          console.log(`LePorno alternative: found ${lepornoCount} more torrents`);
        }

        if (lepornoItems.length > 0) {
          console.log(`LePorno.de: fetching ${lepornoItems.length} magnet links...`);

          // Получаем magnet-ссылки
          const lepornoMagnets = await Promise.all(
            lepornoItems.map(item =>
              fetch(`https://leporno.de/download/file.php?id=${item.fileId}&magnet=1&confirm=1`, {
                headers: { 
                  "User-Agent": "Mozilla/5.0",
                  "Referer": `https://leporno.de/viewtopic.php?t=${item.topicId}`
                },
                redirect: 'manual'
              })
                .then(async r => {
                  const location = r.headers.get('Location');
                  if (location && location.startsWith('magnet:')) {
                    return location.replace(/&amp;/g, '&');
                  }
                  
                  const html = await r.text();
                  const magnetMatch = html.match(/href=["'](magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"']*)["']/i);
                  if (magnetMatch) {
                    return magnetMatch[1].replace(/&amp;/g, '&');
                  }
                  
                  return "";
                })
                .catch(err => {
                  console.error(`LePorno magnet error for ${item.fileId}:`, err.message);
                  return "";
                })
            )
          );

          lepornoItems.forEach((item, i) => {
            const magnet = lepornoMagnets[i];
            
            Results.push({
              Title: item.title,
              Seeders: item.seeders,
              Peers: item.peers,
              Size: item.size,
              Tracker: "LePorno.de",
              MagnetUri: magnet || `https://leporno.de/download/file.php?id=${item.fileId}`,
              Link: `https://leporno.de/viewtopic.php?t=${item.topicId}`,
              PublishDate: parseLepornoDate(item.dateStr),
            });
          });

          console.log(`LePorno.de: added ${lepornoItems.length} results`);
        }
      } else {
        console.log("LePorno.de: no HTML or HTML too short");
        if (lepornoHtml) {
          debug.trackers.leporno.htmlPreview = lepornoHtml.substring(0, 1000);
        }
      }

    } catch (e) {
      console.error("Main error:", e.message, e.stack);
      debug.mainError = { message: e.message, stack: e.stack };
    }

    // Сортировка по сидам
    Results.sort((a, b) => b.Seeders - a.Seeders);

    debug.total = Results.length;
    debug.byTracker = {
      Rutor: Results.filter(r => r.Tracker === "Rutor").length,
      NNMClub: Results.filter(r => r.Tracker === "NNMClub").length,
      XXXTor: Results.filter(r => r.Tracker === "XXXTor").length,
      LePorno: Results.filter(r => r.Tracker === "LePorno.de").length
    };

    return jsonResponse({ 
      Results, 
      Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"],
      debug: debug
    });
  }
};

// ===================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===================================================

function passFilters(title, queryTokens, videoKeywords) {
  const tl = title.toLowerCase();
  
  if (queryTokens.length > 0) {
    const matched = queryTokens.filter(t => tl.includes(t));
    if (matched.length / queryTokens.length < 0.3) return false;
  }
  return true;
}

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", ".").replace(/\s/g, ''));
  const u = unit.toUpperCase();
  if (u.includes("TB") || u.includes("ТБ") || u.includes("TIB")) return Math.round(n * 1024 ** 4);
  if (u.includes("GB") || u.includes("ГБ") || u.includes("GIB")) return Math.round(n * 1024 ** 3);
  if (u.includes("MB") || u.includes("МБ") || u.includes("MIB")) return Math.round(n * 1024 ** 2);
  if (u.includes("KB") || u.includes("КБ") || u.includes("KIB")) return Math.round(n * 1024);
  return 0;
}

function translateUnit(unit) {
  const map = {
    'ТБ': 'TB', 'ГБ': 'GB', 'МБ': 'MB', 'КБ': 'KB'
  };
  return map[unit.toUpperCase()] || unit;
}

function parseXXXTorDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  try {
    const months = {
      'янв': 0, 'фев': 1, 'мар': 2, 'апр': 3, 'май': 4, 'июн': 5,
      'июл': 6, 'авг': 7, 'сен': 8, 'окт': 9, 'ноя': 10, 'дек': 11
    };
    
    const parts = dateStr.toLowerCase().split(/\s+/);
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = months[parts[1]];
      let year = parseInt(parts[2]);
      
      if (year < 100) {
        year += year > 50 ? 1900 : 2000;
      }
      
      if (!isNaN(day) && month !== undefined && !isNaN(year)) {
        return new Date(year, month, day).toISOString();
      }
    }
  } catch (e) {
    console.error("Date parse error:", e);
  }
  
  return new Date().toISOString();
}

function parseLepornoDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  try {
    const months = {
      'янв': 0, 'фев': 1, 'мар': 2, 'апр': 3, 'май': 4, 'июн': 5,
      'июл': 6, 'авг': 7, 'сен': 8, 'окт': 9, 'ноя': 10, 'дек': 11,
      'jan': 0, 'feb': 1, 'mär': 2, 'apr': 3, 'mai': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'okt': 9, 'nov': 10, 'dez': 11,
      'mar': 2, 'may': 4
    };
    
    const match = dateStr.match(/(\d+)\s+(\w+)\s+(\d+),\s+(\d+):(\d+)/i);
    if (match) {
      const day = parseInt(match[1]);
      const monthStr = match[2].toLowerCase().substring(0, 3);
      const month = months[monthStr];
      const year = parseInt(match[3]);
      const hour = parseInt(match[4]);
      const minute = parseInt(match[5]);
      
      if (!isNaN(day) && month !== undefined && !isNaN(year)) {
        return new Date(year, month, day, hour, minute).toISOString();
      }
    }
  } catch (e) {
    console.error("LePorno date parse error:", e);
  }
  
  return new Date().toISOString();
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
