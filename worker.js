export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const query = url.searchParams.get("q") || "4k 2160p";
      
      const searchUrl = `https://xxxtor.com/browse.php?search=${encodeURIComponent(query)}&sort=seeders&order=desc`;
      
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        }
      });
      
      if (!response.ok) {
        return jsonResponse({ 
          Results: [], 
          Indexers: [],
          error: `HTTP ${response.status}: ${response.statusText}` 
        });
      }
      
      const html = await response.text();
      
      // Проверяем, что мы получили реальную страницу, а не заглушку
      if (html.length < 1000 || html.includes("cloudflare") || html.includes("checking your browser")) {
        return jsonResponse({ 
          Results: [], 
          Indexers: [],
          error: "Cloudflare protection or empty response detected",
          html_preview: html.substring(0, 200)
        });
      }

      const Results = [];
      const seen = new Set();

      // Основной парсинг через regex
      const regex = /<tr[^>]*>[\s\S]*?<td[^>]*>[\s\S]*?<a href=["']\/torrent\/(\d+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
      
      let match;
      while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        
        const titleHtml = match[2];
        const title = titleHtml.replace(/<[^>]+>/g, '').trim();
        
        // Извлекаем битрейт из названия или дополнительной информации
        const bitrate = extractBitrate(titleHtml + match[0]);
        
        const sizeText = match[3].replace(/<[^>]+>/g, '').trim();
        const sizeMatch = sizeText.match(/([\d.,]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
        const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
        
        const files = parseInt(match[4].replace(/<[^>]+>/g, '').trim()) || 0;
        const ageText = match[5].replace(/<[^>]+>/g, '').trim();
        const seeders = parseInt(match[6].replace(/<[^>]+>/g, '').trim()) || 0;
        const peers = parseInt(match[7].replace(/<[^>]+>/g, '').trim()) || 0;
        
        // Ищем magnet link и hash
        const magnetMatch = match[0].match(/href=["'](magnet:[^"']+)["']/i);
        const magnetUri = magnetMatch ? magnetMatch[1] : "";
        
        const hashMatch = match[0].match(/href=["']\/torrent\/(\d+)["']/i) || 
                         magnetUri.match(/btih:([a-f0-9]{40})/i);
        const hash = hashMatch ? hashMatch[1] : "";
        
        const publishDate = parseDate(ageText);
        
        Results.push({
          Title:       title,
          Seeders:     seeders,
          Peers:       peers,
          Size:        size,
          Tracker:     "XXXTor",
          MagnetUri:   magnetUri,
          Link:        `https://xxxtor.com/torrent/${id}`,
          PublishDate: publishDate,
          Details:     hash ? `Hash: ${hash}` : "No hash",
          Bitrate:     bitrate || "Unknown",  // ← ДОБАВЛЕНО: информация о битрейте
          Files:       files,                 // ← ДОБАВЛЕНО: количество файлов
          RawSize:     sizeText               // ← ДОБАВЛЕНО: оригинальный текст размера
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
          
          // Обычно: [0] - название, [1] - размер, [2] - файлы, [3] - возраст, [4] - сиды, [5] - пиры, [6] - битрейт/доп. инфо
          const titleCell = cells[0] || "";
          const sizeCell = cells[1] || "";
          const filesCell = cells[2] || "";
          const ageCell = cells[3] || "";
          const seedCell = cells[4] || "";
          const peerCell = cells[5] || "";
          const bitrateCell = cells[6] || ""; // ← ДОБАВЛЕНО: ячейка с битрейтом
          
          const titleMatch = titleCell.match(/>([^<]+)<\/a>/);
          const title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
          
          // Извлекаем битрейт из названия или специальной ячейки
          const bitrate = extractBitrate(titleCell) || extractBitrate(bitrateCell) || "Unknown";
          
          const sizeMatch = sizeCell.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          const files = parseInt(filesCell.replace(/<[^>]+>/g, '').trim()) || 0;
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
            Bitrate:     bitrate,  // ← ДОБАВЛЕНО
            Files:       files,
            RawSize:     sizeCell.replace(/<[^>]+>/g, '').trim()
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

// ← ДОБАВЛЕНО: функция для извлечения битрейта из текста
function extractBitrate(text) {
  if (!text) return null;
  
  // Паттерны для поиска битрейта
  const patterns = [
    // Форматы: 10.5 Mbps, 1500 Kbps, 25Mb/s, 8.2 Mb/s
    /(\d+\.?\d*)\s*(Mb|Kb|Gb|mb|kb|gb)[p\/]?s/i,
    // Форматы: 10000 kbps, 5000 bps
    /(\d+)\s*kbps/i,
    // Форматы в названии: [10.5 Mbps], (15Mb/s), 8.2Mbps
    /\[(\d+\.?\d*)\s*(mb|kb|gb)[p\/]?s\]/i,
    /\((\d+\.?\d*)\s*(mb|kb|gb)[p\/]?s\)/i,
    // Специфичные для видео: 1080p50, 2160p60 (частота кадров как индикатор качества)
    /(1080|2160|720|480)[pi](\d{2,3})/i,
    // Битрейт в видео кодеке: x264 @ 10.5 Mbps, HEVC 15Mb/s
    /(?:x264|x265|hevc|h\.?264|h\.?265|av1)[^\d]*(\d+\.?\d*)\s*(mb|kb|gb)/i,
    // Просто число с Mbps в конце строки или ячейки
    /(\d+\.?\d*)\s*mbps/i,
    // Битрейт в таблице: часто отдельная колонка с числом и единицей
    /<td[^>]*>(\d+\.?\d*)\s*(Mbps|Kbps|Gbps)<\/td>/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let value = parseFloat(match[1]);
      let unit = (match[2] || 'mb').toLowerCase();
      
      // Нормализуем к Mbps для читаемости
      switch(unit) {
        case 'gb': value = value * 1000; break;
        case 'kb': value = value / 1000; break;
        case 'mb': default: break;
      }
      
      return `${value.toFixed(2)} Mbps`;
    }
  }
  
  return null;
}

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
