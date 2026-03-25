export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS support
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

    try {
      // ✅ Исправленный URL
      const searchUrl = `https://xxxtor.com/b.php?search=${encodeURIComponent(query)}`;
      
      const response = await fetch(searchUrl, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Referer": "https://xxxtor.com/",
          "DNT": "1",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
        }
      });

      if (!response.ok) {
        return jsonResponse({ Results: [], Indexers: [], error: `HTTP ${response.status}` });
      }

      const html = await response.text();
      
      // Лог для отладки (смотри в логах Cloudflare Workers)
      console.log("URL:", searchUrl);
      console.log("HTML length:", html.length);
      console.log("HTML preview:", html.substring(0, 1000));

      const Results = [];
      const seen = new Set();

      // Парсим результаты поиска XXXTor
      // Обычно результаты в таблице или div'ах
      
      // Ищем все ссылки на торренты: /torrent.php?id=12345 или /torrent/12345/name
      const torrentRegex = /href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)(?:\/|&[^"']*)?([^"']*)?["']/gi;
      
      let match;
      while ((match = torrentRegex.exec(html)) !== null) {
        const id = match[1];
        let slug = match[2] || "";
        
        // Убираем лишние параметры из slug
        slug = slug.replace(/[?&].*$/, '').trim();
        
        if (seen.has(id)) continue;
        seen.add(id);

        // Формируем название из slug или ищем в HTML
        let title = "";
        if (slug) {
          title = decodeURIComponent(slug.replace(/-/g, ' ')).trim();
        }
        
        // Ищем ближайший родительский блок для доп. информации
        const searchStart = Math.max(0, match.index - 1500);
        const searchEnd = Math.min(html.length, match.index + 1500);
        const block = html.substring(searchStart, searchEnd);

        // Если title пустой, ищем в блоке
        if (!title) {
          const titleMatch = block.match(/<a[^>]*href=["'][^"']*torrent[^"']*["'][^>]*>([^<]+)<\/a>/i)
                          || block.match(/title=["']([^"']+)["']/i)
                          || block.match(/class=["'][^"']*title[^"']*["'][^>]*>([^<]+)/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
          } else {
            title = `Torrent ${id}`;
          }
        }

        // Ищем magnet ссылку
        const magnetMatch = block.match(/href=["'](magnet:\?[^"']+)["']/i)
                         || html.match(new RegExp(`href=["'](magnet:\\?[^"']*${id}[^"']*)["']`, 'i'));
        const magnet = magnetMatch ? magnetMatch[1] : "";
        
        // Извлекаем hash из magnet
        let hash = "";
        if (magnet) {
          const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
          if (hashMatch) hash = hashMatch[1].toLowerCase();
        }

        // Ищем размер файла
        const sizeMatch = block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i)
                       || block.match(/size[^>]*>(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i)
                       || block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)[^<]*<\/td>/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;

        // Ищем сиды (разные варианты разметки)
        const seedMatch = block.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i)
                       || block.match(/seed[^>]*>(\d+)/i)
                       || block.match(/[↑↗]\s*(\d+)/)
                       || block.match(/seeders?[:\s]*(\d+)/i)
                       || block.match(/<td[^>]*>(\d+)<\/td>[^<]*<td[^>]*>(\d+)<\/td>/i); // сиды/пиры в соседних ячейках
        
        // Ищем пиры  
        const peerMatch = block.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i)
                       || block.match(/leech[^>]*>(\d+)/i)
                       || block.match(/[↓↘]\s*(\d+)/)
                       || block.match(/leechers?[:\s]*(\d+)/i);

        const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
        const peers = peerMatch ? parseInt(peerMatch[1]) : 0;

        // Ищем дату
        const dateMatch = block.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)
                       || block.match(/(\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})/)
                       || block.match(/added[:\s]*([^<]+)/i);
        const publishDate = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString();

        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "XXXTor",
          MagnetUri:   hash
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.opentrackr.org:1337`
            : magnet,
          Link:        `https://xxxtor.com/torrent/${id}/${slug || title.replace(/\s+/g, '-').substring(0, 50)}`,
          PublishDate: publishDate,
          Details:     hash ? `Hash: ${hash}` : "No hash"
        });
      }

      // Альтернативный парсинг: если не нашли через regex, пробуем через table rows
      if (Results.length === 0) {
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        
        while ((trMatch = trRegex.exec(html)) !== null) {
          const row = trMatch[1];
          
          // Пропускаем заголовки таблицы
          if (row.includes('<th')) continue;
          
          const linkMatch = row.match(/href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)/i);
          if (!linkMatch) continue;
          
          const id = linkMatch[1];
          if (seen.has(id)) continue;
          seen.add(id);
          
          // Парсим ячейки таблицы
          const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
          
          // Обычно: [0] - название, [1] - размер, [2] - сиды, [3] - пиры
          const titleCell = cells[0] || "";
          const sizeCell = cells[1] || "";
          const seedCell = cells[2] || "";
          const peerCell = cells[3] || "";
          
          const titleMatch = titleCell.match(/>([^<]+)<\/a>/);
          const title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
          
          const sizeMatch = sizeCell.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          const seeders = parseInt(seedCell.replace(/<[^>]+>/g, '').trim()) || 0;
          const peers = parseInt(peerCell.replace(/<[^>]+>/g, '').trim()) || 0;
          
          Results.push({
            Title:       title,
            Seeders:     seeders,
            Peers:       peers,
            Size:        size,
            Tracker:     "XXXTor",
            MagnetUri:   "",
            Link:        `https://xxxtor.com/torrent/${id}`,
            PublishDate: new Date().toISOString(),
          });
        }
      }

      // Сортируем по сидам (больше = выше)
      Results.sort((a, b) => b.Seeders - a.Seeders);

      return jsonResponse({ 
        Results, 
        Indexers: ["XXXTor"],
        meta: {
          query: query,
          url: searchUrl,
          found: Results.length,
          timestamp: new Date().toISOString()
        }
      });

    } catch (e) {
      return jsonResponse({ 
        Results: [], 
        Indexers: [],
        error: e.message,
        stack: e.stack 
      });
    }
  }
};

function parseSizeToBytes(num, unit) {
  const n = parseFloat(num.replace(/,/g, '.'));
  const u = unit.toUpperCase().replace('IB', 'B');
  switch (u) {
    case "TB": return Math.round(n * 1024 ** 4);
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

function parseDate(dateStr) {
  try {
    // Пробуем разные форматы
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {}
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
