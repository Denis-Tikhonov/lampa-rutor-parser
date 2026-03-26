export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ===================================================
    // DEBUG ENDPOINT - ВРЕМЕННЫЙ
    // ===================================================
    if (url.searchParams.get("debug") === "leporno") {
      const query = url.searchParams.get("query") || "2024";
      
      const lepornoHtml = await fetch(`https://leporno.de/search.php`, {
        method: 'POST',
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": "https://leporno.de/search.php",
          "Origin": "https://leporno.de"
        },
        body: new URLSearchParams({
          'keywords': query,
          'terms': 'all',
          'author': '',
          'sc': '1',
          'sf': 'all',
          'sr': 'topics',
          'sk': 't',
          'sd': 'd',
          'st': '0',
          'ch': '300',
          'submit': 'Поиск'
        }).toString()
      }).then(r => r.text()).catch(err => `Error: ${err.message}`);
      
      return new Response(lepornoHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // ... остальной код как раньше ...
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
        // LePorno.de - POST-запрос
        fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": "https://leporno.de/search.php",
            "Origin": "https://leporno.de"
          },
          body: new URLSearchParams({
            'keywords': query,
            'terms': 'all',
            'author': '',
            'sc': '1',
            'sf': 'all',
            'sr': 'topics',
            'sk': 't',
            'sd': 'd',
            'st': '0',
            'ch': '300',
            'submit': 'Поиск'
          }).toString()
        }).then(async r => {
          const status = r.status;
          const text = await r.text();
          
          debug.trackers.leporno = {
            status: status,
            htmlLength: text.length,
            method: 'POST',
            url: 'https://leporno.de/search.php',
            htmlPreview: text.substring(0, 3000)
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
          
          xxxtorCount++;
          
          Results.push({
            Title: title,
            Seeders: seeders,
            Peers: peers,
            Size: size,
            Tracker: "XXXTor",
            MagnetUri: magnet || (hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&tr=udp://tracker.opentrackr.org:1337/announce` : ""),
            Link: `https://xxxtor.com/torrent/${id}/`,
            PublishDate: new Date().toISOString(),
          });
        }
      }

      // ===================================================
      // ПАРСИНГ LePorno.de
      // ===================================================
      if (lepornoHtml && lepornoHtml.length > 30000 && debug.trackers.leporno?.status === 200) {
        console.log("LePorno.de HTML length:", lepornoHtml.length);
        
        let lepornoCount = 0;
        const lepornoItems = [];

        // phpBB выдает результаты в формате:
        // <li class="row">...результат...</li> или
        // <dt>...</dt><dd>...</dd>
        
        // СТРАТЕГИЯ 1: Поиск блоков результатов <li class="row">
        const resultBlockRegex = /<li\s+class=["']row["'][^>]*>([\s\S]*?)<\/li>/gi;
        let blockMatch;
        
        while ((blockMatch = resultBlockRegex.exec(lepornoHtml)) !== null) {
          const block = blockMatch[1];
          
          // Ищем ссылку на топик
          const topicMatch = block.match(/href=["']\.\/viewtopic\.php\?[^"']*[&?]t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([^<]+)<\/a>/i);
          if (!topicMatch) continue;
          
          const topicId = topicMatch[1];
          let title = topicMatch[2].trim();
          
          if (seen.has(`leporno_${topicId}`)) continue;
          seen.add(`leporno_${topicId}`);
          
          title = title.replace(/&amp;/g, '&')
                      .replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
          
          // Ищем категорию (для определения fileId позже)
          const forumMatch = block.match(/href=["']\.\/viewforum\.php\?f=(\d+)/);
          const forumId = forumMatch ? forumMatch[1] : "";
          
          lepornoItems.push({
            topicId,
            forumId,
            title
          });
          
          lepornoCount++;
        }

        // СТРАТЕГИЯ 2: Если не нашли через <li>, ищем через <tr valign="middle">
        if (lepornoCount === 0) {
          const rowRegex = /<tr\s+valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi;
          let rowMatch;
          
          while ((rowMatch = rowRegex.exec(lepornoHtml)) !== null) {
            const row = rowMatch[1];
            
            if (!row.includes('viewtopic.php')) continue;
            
            const topicMatch = row.match(/viewtopic\.php\?[^"']*[&?]t=(\d+)[^"']*["'][^>]*class=["']topictitle["'][^>]*>([^<]+)<\/a>/i);
            if (!topicMatch) continue;
            
            const topicId = topicMatch[1];
            let title = topicMatch[2].trim();
            
            if (seen.has(`leporno_${topicId}`)) continue;
            seen.add(`leporno_${topicId}`);
            
            title = title.replace(/&amp;/g, '&')
                        .replace(/&quot;/g, '"')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
            
            const forumMatch = row.match(/viewforum\.php\?f=(\d+)/);
            const forumId = forumMatch ? forumMatch[1] : "";
            
            // Размер и сиды из описания
            const sizeMatch = row.match(/(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);
            const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], translateUnit(sizeMatch[2])) : 0;
            
            const seedMatch = row.match(/<span\s+class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i);
            const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
            
            const peerMatch = row.match(/<span\s+class=["'][^"']*leech[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i);
            const peers = peerMatch ? parseInt(peerMatch[1]) : 0;
            
            const downloadMatch = row.match(/download\/file\.php\?id=(\d+)/);
            const fileId = downloadMatch ? downloadMatch[1] : "";
            
            lepornoItems.push({
              topicId,
              forumId,
              fileId,
              title,
              size,
              seeders,
              peers
            });
            
            lepornoCount++;
          }
        }

        debug.trackers.leporno.parsedCount = lepornoCount;
        console.log(`LePorno.de: parsed ${lepornoCount} torrents`);

        if (lepornoItems.length > 0) {
          // Для каждого топика делаем запрос на страницу, чтобы получить fileId и magnet
          const lepornoDetails = await Promise.all(
            lepornoItems.map(item =>
              fetch(`https://leporno.de/viewtopic.php?f=${item.forumId || ''}&t=${item.topicId}`, {
                headers: { 
                  "User-Agent": "Mozilla/5.0",
                  "Referer": "https://leporno.de/search.php"
                }
              })
                .then(async r => {
                  const html = await r.text();
                  
                  // Ищем fileId если его еще нет
                  const fileIdMatch = html.match(/download\/file\.php\?id=(\d+)/);
                  const fileId = item.fileId || (fileIdMatch ? fileIdMatch[1] : "");
                  
                  // Ищем размер если его еще нет
                  let size = item.size || 0;
                  if (!size) {
                    const sizeMatch = html.match(/(?:Размер|Größe|Size):\s*<b>([\d.,]+)\s*&nbsp;\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)/i);
                    size = sizeMatch ? parseSizeToBytes(sizeMatch[1], translateUnit(sizeMatch[2])) : 0;
                  }
                  
                  // Ищем сиды/пиры если их еще нет
                  let seeders = item.seeders || 0;
                  let peers = item.peers || 0;
                  
                  if (!seeders) {
                    const seedMatch = html.match(/<span\s+class=["'][^"']*seed[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i);
                    seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
                  }
                  
                  if (!peers) {
                    const peerMatch = html.match(/<span\s+class=["'][^"']*leech[^"']*["'][^>]*><b>(\d+)<\/b><\/span>/i);
                    peers = peerMatch ? parseInt(peerMatch[1]) : 0;
                  }
                  
                  return { fileId, size, seeders, peers };
                })
                .catch(() => ({ fileId: "", size: 0, seeders: 0, peers: 0 }))
            )
          );

          // Получаем magnet-ссылки
          const lepornoMagnets = await Promise.all(
            lepornoDetails.map((detail, i) => {
              if (!detail.fileId) return Promise.resolve("");
              
              return fetch(`https://leporno.de/download/file.php?id=${detail.fileId}&magnet=1&confirm=1`, {
                headers: { 
                  "User-Agent": "Mozilla/5.0",
                  "Referer": `https://leporno.de/viewtopic.php?t=${lepornoItems[i].topicId}`
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
                  return magnetMatch ? magnetMatch[1].replace(/&amp;/g, '&') : "";
                })
                .catch(() => "");
            })
          );

          lepornoItems.forEach((item, i) => {
            const detail = lepornoDetails[i];
            const magnet = lepornoMagnets[i];
            
            Results.push({
              Title: item.title,
              Seeders: detail.seeders,
              Peers: detail.peers,
              Size: detail.size,
              Tracker: "LePorno.de",
              MagnetUri: magnet || (detail.fileId ? `https://leporno.de/download/file.php?id=${detail.fileId}` : ""),
              Link: `https://leporno.de/viewtopic.php?f=${item.forumId}&t=${item.topicId}`,
              PublishDate: new Date().toISOString(),
            });
          });

          console.log(`LePorno.de: added ${lepornoItems.length} results`);
        }
      } else if (lepornoHtml && lepornoHtml.length <= 30000) {
        debug.trackers.leporno.message = "Page too short - possibly no results or blocked";
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

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
