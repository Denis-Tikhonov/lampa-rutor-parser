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
      // ПАРСИНГ XXXTor - ПОЛНОСТЬЮ ПЕРЕРАБОТАННЫЙ
      // ===================================================
      if (xxxtorHtml && xxxtorHtml.length > 100) {
        console.log("XXXTor HTML length:", xxxtorHtml.length);
        
        let xxxtorCount = 0;

        // Ищем таблицу с результатами поиска
        // XXXTor обычно использует структуру: <tr> с несколькими <td>
        const tableRegex = /<table[^>]*class=["'][^"']*torrent[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;
        let tableMatch = tableRegex.exec(xxxtorHtml);
        
        // Если не нашли таблицу с классом torrent, ищем любую таблицу после поиска
        if (!tableMatch) {
          const allTablesRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
          let tempMatch;
          while ((tempMatch = allTablesRegex.exec(xxxtorHtml)) !== null) {
            // Проверяем, содержит ли таблица ссылки на торренты
            if (tempMatch[1].includes('/torrent/')) {
              tableMatch = tempMatch;
              break;
            }
          }
        }

        if (tableMatch) {
          const tableContent = tableMatch[1];
          console.log("XXXTor: found table, length:", tableContent.length);

          // Парсим строки таблицы
          const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rowMatch;
          
          while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const row = rowMatch[1];
            
            // Пропускаем заголовки
            if (row.includes('<th') || row.includes('thead')) continue;
            
            // Извлекаем все ячейки
            const cells = [];
            const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            let cellMatch;
            
            while ((cellMatch = cellRegex.exec(row)) !== null) {
              cells.push(cellMatch[1].trim());
            }
            
            if (cells.length < 3) continue;
            
            // Обычная структура XXXTor:
            // cells[0] или [1] - название с ссылкой
            // одна из ячеек - размер (содержит GB/MB)
            // одна из ячеек - сиды (обычно зеленое число)
            // одна из ячеек - пиры (обычно красное число)
            
            // Ищем ячейку с названием и ID
            let id = "";
            let title = "";
            let titleCellIndex = -1;
            
            for (let i = 0; i < cells.length; i++) {
              const linkMatch = cells[i].match(/href=["']\/torrent\/(\d+)(?:\/([^"']*))?["'][^>]*>([^<]*)<\/a>/i);
              if (linkMatch) {
                id = linkMatch[1];
                const slug = linkMatch[2] || "";
                title = linkMatch[3].trim();
                
                // Если название пустое, берем из slug
                if (!title && slug) {
                  title = decodeURIComponent(slug.replace(/-/g, ' ')).trim();
                }
                
                // Декодируем HTML entities
                title = title.replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code))
                            .replace(/<[^>]+>/g, ''); // удаляем оставшиеся теги
                
                titleCellIndex = i;
                break;
              }
            }
            
            if (!id || !title) continue;
            if (seen.has(`xxxtor_${id}`)) continue;
            seen.add(`xxxtor_${id}`);
            
            // Ищем размер во всех ячейках
            let size = 0;
            for (const cell of cells) {
              const cleanCell = cell.replace(/<[^>]+>/g, '');
              const sizeMatch = cleanCell.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
              if (sizeMatch) {
                size = parseSizeToBytes(sizeMatch[1], sizeMatch[2]);
                console.log(`XXXTor: found size ${sizeMatch[1]} ${sizeMatch[2]} = ${size} bytes`);
                break;
              }
            }
            
            // Ищем сиды и пиры
            let seeders = 0;
            let peers = 0;
            
            for (let i = 0; i < cells.length; i++) {
              if (i === titleCellIndex) continue;
              
              const cleanCell = cells[i].replace(/<[^>]+>/g, '').trim();
              const num = parseInt(cleanCell);
              
              if (!isNaN(num) && num >= 0) {
                // Эвристика: обычно сиды идут раньше пиров
                // Также ищем по цвету или классу
                if (cells[i].includes('green') || cells[i].includes('seed')) {
                  seeders = num;
                  console.log(`XXXTor: found seeders ${num}`);
                } else if (cells[i].includes('red') || cells[i].includes('leech') || cells[i].includes('peer')) {
                  peers = num;
                  console.log(`XXXTor: found peers ${num}`);
                } else if (seeders === 0) {
                  seeders = num;
                } else if (peers === 0) {
                  peers = num;
                }
              }
            }
            
            // Ищем magnet в строке
            const magnetMatch = row.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
            const magnet = magnetMatch ? magnetMatch[1] : "";
            const hash = magnetMatch ? magnetMatch[2].toLowerCase() : "";
            
            xxxtorCount++;
            
            Results.push({
              Title: title,
              Seeders: seeders,
              Peers: peers,
              Size: size,
              Tracker: "XXXTor",
              MagnetUri: hash 
                ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.opentrackr.org:1337`
                : magnet,
              Link: `https://xxxtor.com/torrent/${id}`,
              PublishDate: new Date().toISOString(),
              _debug: {
                cellCount: cells.length,
                size: size,
                seeders: seeders,
                peers: peers
              }
            });
          }
          
          console.log(`XXXTor: parsed ${xxxtorCount} torrents from table`);
        } else {
          console.log("XXXTor: table not found, trying alternative parsing");
          
          // АЛЬТЕРНАТИВНЫЙ МЕТОД: построчный парсинг всего HTML
          const lines = xxxtorHtml.split('\n');
          let currentTorrent = null;
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Ищем начало торрента
            const linkMatch = line.match(/href=["']\/torrent\/(\d+)(?:\/([^"']*))?["'][^>]*>([^<]*)<\/a>/i);
            if (linkMatch) {
              if (currentTorrent && currentTorrent.id) {
                // Сохраняем предыдущий
                if (!seen.has(`xxxtor_${currentTorrent.id}`)) {
                  seen.add(`xxxtor_${currentTorrent.id}`);
                  Results.push({
                    Title: currentTorrent.title,
                    Seeders: currentTorrent.seeders,
                    Peers: currentTorrent.peers,
                    Size: currentTorrent.size,
                    Tracker: "XXXTor",
                    MagnetUri: currentTorrent.magnet,
                    Link: `https://xxxtor.com/torrent/${currentTorrent.id}`,
                    PublishDate: new Date().toISOString(),
                  });
                  xxxtorCount++;
                }
              }
              
              // Начинаем новый
              const id = linkMatch[1];
              let title = linkMatch[3].trim();
              if (!title && linkMatch[2]) {
                title = decodeURIComponent(linkMatch[2].replace(/-/g, ' ')).trim();
              }
              
              currentTorrent = {
                id: id,
                title: title.replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
                seeders: 0,
                peers: 0,
                size: 0,
                magnet: ""
              };
            }
            
            // Если есть текущий торрент, ищем его данные в следующих строках
            if (currentTorrent) {
              // Размер
              const sizeMatch = line.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
              if (sizeMatch && currentTorrent.size === 0) {
                currentTorrent.size = parseSizeToBytes(sizeMatch[1], sizeMatch[2]);
              }
              
              // Сиды
              const seedMatch = line.match(/(?:seed|green)[^>]*>(\d+)/i);
              if (seedMatch && currentTorrent.seeders === 0) {
                currentTorrent.seeders = parseInt(seedMatch[1]);
              }
              
              // Пиры
              const peerMatch = line.match(/(?:leech|peer|red)[^>]*>(\d+)/i);
              if (peerMatch && currentTorrent.peers === 0) {
                currentTorrent.peers = parseInt(peerMatch[1]);
              }
              
              // Magnet
              const magnetMatch = line.match(/href=["'](magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"']*)["']/i);
              if (magnetMatch && !currentTorrent.magnet) {
                currentTorrent.magnet = `magnet:?xt=urn:btih:${magnetMatch[2]}&dn=${encodeURIComponent(currentTorrent.title)}`;
              }
            }
          }
          
          // Сохраняем последний
          if (currentTorrent && currentTorrent.id && !seen.has(`xxxtor_${currentTorrent.id}`)) {
            Results.push({
              Title: currentTorrent.title,
              Seeders: currentTorrent.seeders,
              Peers: currentTorrent.peers,
              Size: currentTorrent.size,
              Tracker: "XXXTor",
              MagnetUri: currentTorrent.magnet,
              Link: `https://xxxtor.com/torrent/${currentTorrent.id}`,
              PublishDate: new Date().toISOString(),
            });
            xxxtorCount++;
          }
          
          console.log(`XXXTor: parsed ${xxxtorCount} torrents via line-by-line`);
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
  // Для XXXTor ослабляем фильтр по видеоформатам
  // if (!videoKeywords.test(tl)) return false;
  
  if (queryTokens.length > 0) {
    const matched = queryTokens.filter(t => tl.includes(t));
    if (matched.length / queryTokens.length < 0.3) return false;
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
