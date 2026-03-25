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

    const Results = [];
    const seen = new Set();
    const errors = [];

    // Параллельный поиск по обоим сайтам
    const searchPromises = [
      searchXXXTor(query).catch(e => { errors.push(`XXXTor: ${e.message}`); return []; }),
      searchLePorno(query).catch(e => { errors.push(`LePorno: ${e.message}`); return []; })
    ];

    const resultsArray = await Promise.all(searchPromises);
    
    // Объединяем результаты
    for (const siteResults of resultsArray) {
      for (const item of siteResults) {
        // Уникальность по hash или link
        const key = item.MagnetUri || item.Link;
        if (seen.has(key)) continue;
        seen.add(key);
        Results.push(item);
      }
    }

    // Сортируем по сидам (больше = выше)
    Results.sort((a, b) => b.Seeders - a.Seeders);

    return jsonResponse({ 
      Results, 
      Indexers: ["XXXTor", "LePorno"],
      meta: {
        query: query,
        totalResults: Results.length,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString()
      }
    });
  }
};

// ==================== XXXTor ====================
async function searchXXXTor(query) {
  const searchUrl = `https://xxxtor.com/b.php?search=${encodeURIComponent(query)}`;
  
  const response = await fetch(searchUrl, {
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": "https://xxxtor.com/",
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  
  const results = [];
  const seenIds = new Set();
  
  // Парсинг таблицы результатов
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  
  while ((trMatch = trRegex.exec(html)) !== null) {
    const row = trMatch[1];
    if (row.includes('<th')) continue;
    
    const linkMatch = row.match(/href=["']\/(?:torrent\.php\?id=|torrent\/)(\d+)(?:\/([^"']*))?["']/i);
    if (!linkMatch) continue;
    
    const id = linkMatch[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    
    const slug = (linkMatch[2] || "").replace(/[?&].*$/, '');
    
    // Парсим ячейки
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length < 3) continue;
    
    const titleCell = cells[0];
    const sizeCell = cells[1];
    const seedCell = cells[2];
    const peerCell = cells[3] || "";
    const dateCell = cells[4] || "";
    
    // Название
    const titleMatch = titleCell.match(/>([^<]+)<\/a>/i) 
                    || titleCell.match(/title=["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
    
    // Magnet/hash
    const magnetMatch = row.match(/href=["'](magnet:\?[^"']+)["']/i);
    const magnet = magnetMatch ? magnetMatch[1] : "";
    let hash = "";
    if (magnet) {
      const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
      if (hashMatch) hash = hashMatch[1].toLowerCase();
    }
    
    // Размер
    const sizeMatch = sizeCell.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
    const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
    
    // Сиды/пиры
    const seeders = parseInt(seedCell.replace(/<[^>]+>/g, '').trim()) || 0;
    const peers = parseInt(peerCell.replace(/<[^>]+>/g, '').trim()) || 0;
    
    // Дата
    const dateStr = dateCell.replace(/<[^>]+>/g, '').trim();
    const publishDate = parseDate(dateStr);

    results.push({
      Title:       title,
      Seeders:     seeders,
      Peers:       peers,
      Size:        size,
      Tracker:     "XXXTor",
      MagnetUri:   hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}` : magnet,
      Link:        `https://xxxtor.com/torrent/${id}/${slug || title.replace(/\s+/g, '-').substring(0, 50)}`,
      PublishDate: publishDate,
      Category:    "XXX",
    });
  }
  
  return results;
}

// ==================== LePorno.de ====================
async function searchLePorno(query) {
  const searchUrl = `https://leporno.de/torrents/?search=${encodeURIComponent(query)}&order=seeders&by=DESC`;
  
  const response = await fetch(searchUrl, {
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5,de;q=0.3",
      "Referer": "https://leporno.de/",
      "Cookie": "age_verified=1",
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  
  const results = [];
  const seenIds = new Set();
  
  // Пробуем разные варианты структуры
  
  // Вариант 1: div с классом torrent-item
  let itemRegex = /<div[^>]*class=["'][^"']*torrent-item["'][^>]*>([\s\S]*?)<\/div>/gi;
  let matches = [...html.matchAll(itemRegex)];
  
  // Вариант 2: строки таблицы
  if (matches.length === 0) {
    itemRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    matches = [...html.matchAll(itemRegex)];
  }
  
  // Вариант 3: article
  if (matches.length === 0) {
    itemRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    matches = [...html.matchAll(itemRegex)];
  }
  
  for (const match of matches) {
    const block = match[1];
    if (block.includes('<th') || block.includes('header') || block.length < 50) continue;
    
    // Ищем ID и ссылку
    const linkMatch = block.match(/href=["']\/torrent\/(\d+)-([^"']+)["']/i)
                   || block.match(/href=["']\/torrents\/(\d+)\/([^"']+)["']/i)
                   || block.match(/href=["'][^"']*\/(\d+)[^"']*["'][^>]*>([^<]+)/i);
    
    if (!linkMatch) continue;
    
    const id = linkMatch[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    
    let slug = linkMatch[2] || "";
    let title = "";
    
    // Очищаем slug
    slug = slug.replace(/[?&].*$/, '').trim();
    
    if (slug && !slug.includes('<')) {
      title = decodeURIComponent(slug.replace(/-/g, ' ')).trim();
    } else {
      // Ищем title отдельно
      const titleMatch = block.match(/class=["']title["'][^>]*>([^<]+)/i)
                      || block.match(/<a[^>]*href=["'][^"']*torrent[^"']*["'][^>]*>([^<]+)<\/a>/i)
                      || block.match(/<h[23][^>]*>([^<]+)/i);
      title = titleMatch ? titleMatch[1].trim() : `Torrent ${id}`;
    }
    
    // Magnet/hash
    const magnetMatch = block.match(/href=["'](magnet:\?[^"']+)["']/i)
                     || block.match(/data-magnet=["']([^"']+)["']/i);
    const magnet = magnetMatch ? magnetMatch[1] : "";
    let hash = "";
    if (magnet) {
      const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
      if (hashMatch) hash = hashMatch[1].toLowerCase();
    }
    
    // Размер
    const sizeMatch = block.match(/(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i)
                   || block.match(/size["']?[^>]*>(\d+[.,]?\d*)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
    const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
    
    // Сиды (LePorno: ↑123 или span.seed)
    const seedMatch = block.match(/[↑↗]\s*(\d+)/)
                   || block.match(/seed(?:ers?)?["']?[^>]*>(\d+)/i)
                   || block.match(/class=["'][^"']*seed[^"']*["'][^>]*>(\d+)/i)
                   || block.match(/<td[^>]*>(\d+)<\/td>[^<]*<td[^>]*>(\d+)<\/td>/i);
    
    const peerMatch = block.match(/[↓↘]\s*(\d+)/)
                   || block.match(/leech(?:ers?)?["']?[^>]*>(\d+)/i)
                   || block.match(/class=["'][^"']*leech[^"']*["'][^>]*>(\d+)/i);
    
    const seeders = seedMatch ? parseInt(seedMatch[1]) : 0;
    const peers = peerMatch ? parseInt(peerMatch[1]) : 0;
    
    // Дата
    const dateMatch = block.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)
                   || block.match(/(\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2})/)
                   || block.match(/added[:\s]*([^<]+)/i)
                   || block.match(/date["']?[^>]*>([^<]+)/i);
    const publishDate = dateMatch ? parseDate(dateMatch[1]) : new Date().toISOString();
    
    // Категория
    const catMatch = block.match(/category["']?[^>]*>([^<]+)/i)
                  || block.match(/class=["']cat[^"']*["'][^>]*>([^<]+)/i);
    const category = catMatch ? catMatch[1].trim() : "XXX";

    results.push({
      Title:       title,
      Seeders:     seeders,
      Peers:       peers,
      Size:        size,
      Tracker:     "LePorno",
      MagnetUri:   hash ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}` : magnet,
      Link:        `https://leporno.de/torrent/${id}-${slug || title.replace(/\s+/g, '-').substring(0, 50)}`,
      PublishDate: publishDate,
      Category:    category,
    });
  }
  
  return results;
}

// ==================== Helpers ====================

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
  if (!dateStr) return new Date().toISOString();
  try {
    const clean = dateStr.trim();
    // Пробуем разные разделители
    const d = new Date(clean.replace(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/, '$3-$2-$1'));
    if (!isNaN(d.getTime())) return d.toISOString();
    
    // Стандартный парсинг
    const d2 = new Date(clean);
    if (!isNaN(d2.getTime())) return d2.toISOString();
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
