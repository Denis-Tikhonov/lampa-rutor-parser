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

    try {
      // ===================================================
      // ПАРАЛЛЕЛЬНЫЕ ЗАПРОСЫ
      // ===================================================
      const RUTOR_CATEGORIES = [1, 2, 4, 5, 10];
      const encodedQuery = encodeURIComponent(query);

      const [rutorPages, nnmBuffer, xxxtorHtml] = await Promise.all([
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
            "Accept-Language": "en-US,en;q=0.5",
            "Referer": "https://xxxtor.com/",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
          }
        }).then(r => r.text()).catch(err => {
          console.error("XXXTor fetch error:", err);
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
      // ПАРСИНГ XXXTor - УЛУЧШЕННЫЙ
      // ===================================================
      if (xxxtorHtml && xxxtorHtml.length > 100) {
        console.log("XXXTor HTML length:", xxxtorHtml.length);
        
        // Множественные стратегии парсинга
        let xxxtorCount = 0;

        // СТРАТЕГИЯ 1: Поиск всех ссылок на торренты
        const torrentLinkRegex = /href=["'](\/torrent\/(\d+)(?:\/([^"']*))?)["'][^>]*>([^<]*)<\/a>/gi;
        let linkMatch;
        
        while ((linkMatch = torrentLinkRegex.exec(xxxtorHtml)) !== null) {
          const fullPath = linkMatch[1];
          const id = linkMatch[2];
          const slug = linkMatch[3] || "";
          let title = linkMatch[4].trim();
          
          // Декодируем HTML entities
          title = title.replace(/&quot;/g, '"')
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
          
          if (!title && slug) {
            title = decodeURIComponent(slug.replace(/-/g, ' ')).trim();
          }
          
          if (!title || title.length < 3) continue;
          if (seen.has(`xxxtor_${id}`)) continue;
          
          // Извлекаем окружающий блок для доп. информации
          const contextStart = Math.max(0, linkMatch.index - 2000);
          const contextEnd = Math.min(xxxtorHtml.length, linkMatch.index + 2000);
          const context = xxxtorHtml.substring(contextStart, contextEnd);
          
          // Ищем размер в контексте
          const sizeMatch = context.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          // Ищем сиды/пиры (разные варианты)
          const seedMatch = context.match(/(?:seed|↑)[^\d]*(\d+)/i)
                         || context.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i);
          const peerMatch = context.match(/(?:leech|peer|↓)[^\d]*(\d+)/i)
                         || context.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i);
          
          const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
          const peers = peerMatch ? parseInt(peerMatch[1]) : 0;
          
          // Ищем magnet в контексте
          const magnetMatch = context.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
          const magnet = magnetMatch ? magnetMatch[1] : "";
          const hash = magnetMatch ? magnetMatch[2].toLowerCase() : "";
          
          seen.add(`xxxtor_${id}`);
          xxxtorCount++;
          
          Results.push({
            Title: title,
            Seeders: seeders,
            Peers: peers,
            Size: size,
            Tracker: "XXXTor",
            MagnetUri: hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&tr=udp://tracker.openbittorrent.com:80` : magnet,
            Link: `https://xxxtor.com${fullPath}`,
            PublishDate: new Date().toISOString(),
          });
        }

        // СТРАТЕГИЯ 2: Парсинг таблиц (если первая не сработала)
        if (xxxtorCount === 0) {
          console.log("XXXTor: trying table parsing");
          const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
          let tableMatch;
          
          while ((tableMatch = tableRegex.exec(xxxtorHtml)) !== null) {
            const tableContent = tableMatch[1];
            const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let rowMatch;
            
            while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
              const row = rowMatch[1];
              if (row.includes('<th')) continue;
              
              const cells = [];
              const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
              let cellMatch;
              while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(cellMatch[1]);
              }
              
              if (cells.length < 2) continue;
              
              const linkInCell = cells[0].match(/href=["']\/torrent\/(\d+)[^"']*["'][^>]*>([^<]+)<\/a>/i);
              if (!linkInCell) continue;
              
              const id = linkInCell[1];
              let title = linkInCell[2].trim();
              
              title = title.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
              
              if (seen.has(`xxxtor_${id}`)) continue;
              seen.add(`xxxtor_${id}`);
              
              const sizeMatch = cells[1]?.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
              const seeders = parseInt((cells[2] || "0").replace(/<[^>]+>/g, '').trim()) || 0;
              const peers = parseInt((cells[3] || "0").replace(/<[^>]+>/g, '').trim()) || 0;
              
              xxxtorCount++;
              
              Results.push({
                Title: title,
                Seeders: seeders,
                Peers: peers,
                Size: sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0,
                Tracker: "XXXTor",
                MagnetUri: "",
                Link: `https://xxxtor.com/torrent/${id}`,
                PublishDate: new Date().toISOString(),
              });
            }
          }
        }

        console.log(`XXXTor: found ${xxxtorCount} torrents`);
        
        // СТРАТЕГИЯ 3: Простой поиск ID торрентов (fallback)
        if (xxxtorCount === 0) {
          console.log("XXXTor: trying simple ID extraction");
          const simpleRegex = /\/torrent\/(\d+)/g;
          const foundIds = new Set();
          let simpleMatch;
          
          while ((simpleMatch = simpleRegex.exec(xxxtorHtml)) !== null) {
            const id = simpleMatch[1];
            if (!foundIds.has(id)) {
              foundIds.add(id);
              Results.push({
                Title: `Torrent ${id}`,
                Seeders: 0,
                Peers: 0,
                Size: 0,
                Tracker: "XXXTor",
                MagnetUri: "",
                Link: `https://xxxtor.com/torrent/${id}`,
                PublishDate: new Date().toISOString(),
              });
            }
          }
          console.log(`XXXTor: simple extraction found ${foundIds.size} IDs`);
        }

      } else {
        console.log("XXXTor: no HTML or HTML too short");
      }

    } catch (e) {
      console.error("Main error:", e.message, e.stack);
    }

    // Сортировка по сидам
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ 
      Results, 
      Indexers: ["Rutor", "NNMClub", "XXXTor"],
      debug: {
        query: query,
        total: Results.length,
        byTracker: {
          Rutor: Results.filter(r => r.Tracker === "Rutor").length,
          NNMClub: Results.filter(r => r.Tracker === "NNMClub").length,
          XXXTor: Results.filter(r => r.Tracker === "XXXTor").length
        }
      }
    });
  }
};

// ===================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===================================================

function passFilters(title, queryTokens, videoKeywords) {
  const tl = title.toLowerCase();
  // Для XXXTor можем ослабить фильтр videoKeywords (они не всегда указывают формат)
  // if (!videoKeywords.test(tl)) return false;
  
  if (queryTokens.length > 0) {
    const matched = queryTokens.filter(t => tl.includes(t));
    if (matched.length / queryTokens.length < 0.3) return false; // понижен порог до 30%
  }
  return true;
}

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(",", "."));
  const u = unit.toUpperCase();
  if (u.includes("TB") || u.includes("TIB")) return Math.round(n * 1024 ** 4);
  if (u.includes("GB") || u.includes("GIB")) return Math.round(n * 1024 ** 3);
  if (u.includes("MB") || u.includes("MIB")) return Math.round(n * 1024 ** 2);
  if (u.includes("KB") || u.includes("KIB")) return Math.round(n * 1024);
  return 0;
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
