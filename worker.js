export default {
  async fetch(request) {
    const url = new URL(request.url);
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
    const Results = [];
    const seen = new Set();
    const debug = { query, trackers: {} };
    
    try {
      // 1. ПЕРВИЧНЫЕ ЗАПРОСЫ
      let lepornoHtml = "";
      let lepornoError = null;
      let lepornoStatus = 0;
      
      // Пробуем POST запрос как в оригинале
      try {
        const lepornoRes = await fetch(`https://leporno.de/search.php`, {
          method: 'POST',
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", 
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
          },
          body: `keywords=${encodedQuery}&tracker_search=torrent&terms=all&sf=titleonly&sr=topics&submit=Search`
        });
        lepornoStatus = lepornoRes.status;
        lepornoHtml = await lepornoRes.text();
      } catch (e) {
        lepornoError = e.message;
      }
      
      // Отладка LePorno
      debug.trackers.leporno = {
        status: lepornoStatus,
        error: lepornoError,
        htmlLength: lepornoHtml.length,
        htmlStart: lepornoHtml.substring(0, 500),
        containsMiddle: lepornoHtml.includes('valign="middle"'),
        containsTopictitle: lepornoHtml.includes('topictitle'),
        containsDownload: lepornoHtml.includes('download/file.php')
      };
      
      const [rutorPages, nnmBuffer, xxxtorHtml] = await Promise.all([
        Promise.all([1, 2, 4, 5, 10].map(cat =>
          fetch(`https://rutor.info/search/0/0/0${cat}0/0/${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
        )),
        fetch(`https://nnmclub.to/forum/tracker.php?nm=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.arrayBuffer()).catch(() => null),
        fetch(`https://xxxtor.com/b.php?search=${encodedQuery}`, { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.text()).catch(() => "")
      ]);
      
      // 2. RUTOR
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
      
      // 3. NNMCLUB
      if (nnmBuffer) {
        const h = new TextDecoder("windows-1251").decode(nnmBuffer);
        const rows = h.match(/<tr class="p?row[12]">([\s\S]*?)<\/tr>/g) || [];
        const nnmItems = [];
        for (const r of rows) {
          const t = r.match(/href="viewtopic\.php\?t=(\d+)"[^>]*><b>([^<]+)<\/b>/);
          if (t) {
            const id = t[1], title = t[2].trim();
            const sizeMatch = r.match(/<u>(\d+)<\/u>/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            const seedsMatch = r.match(/class="seedmed"><b>(\d+)<\/b>/);
            const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
            const peersMatch = r.match(/class="leechmed"><b>(\d+)<\/b>/);
            const peers = peersMatch ? parseInt(peersMatch[1]) : 0;
            nnmItems.push({ id, title, size, seeds, peers });
          }
        }
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
                  Title: it.title, Seeders: it.seeds, Peers: it.peers, Size: it.size,
                  Tracker: "NNMClub", MagnetUri: magnet[1].replace(/&amp;/g, '&'),
                  Link: `https://nnmclub.to/forum/viewtopic.php?t=${it.id}`, PublishDate: new Date().toISOString()
                });
              }
            }
          } catch (e) {}
        }));
      }
      
      // 4. XXXTOR
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
            Size: sz ? parseSizeToBytes(sz[1], sz[2]) : 0, Tracker: "XXXTor",
            MagnetUri: mag[1].replace(/&amp;/g, '&'), Link: `https://xxxtor.com/torrent/${t[1]}/`,
            PublishDate: new Date().toISOString()
          });
        }
      }
      
      // 5. LEPORNO.DE
      if (lepornoHtml && lepornoHtml.length > 100) {
        const rowRegex = /<tr\s+valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi;
        const lepItems = [];
        let rm;
        
        debug.trackers.leporno.parsing = { rowsFound: 0, itemsParsed: 0 };
        
        while ((rm = rowRegex.exec(lepornoHtml)) !== null) {
          debug.trackers.leporno.parsing.rowsFound++;
          const row = rm[1];
          
          const fileIdMatch = row.match(/download\/file\.php\?id=(\d+)/);
          if (!fileIdMatch) continue;
          const fileId = fileIdMatch[1];
          
          const titleMatch = row.match(/class=["']topictitle["'][^>]*>([^<]+)<\/a>/i);
          if (!titleMatch) continue;
          const title = titleMatch[1].trim();
          
          const topicMatch = row.match(/viewtopic\.php\?f=(\d+)&amp;t=(\d+)/);
          const topicId = topicMatch ? topicMatch[2] : fileId;
          const forumId = topicMatch ? topicMatch[1] : '0';
          
          const sizeMatch = row.match(/Размер:\s*<b>([\d.,]+)&nbsp;(ТБ|ГБ|МБ|КБ|TB|GB|MB|KB)<\/b>/i);
          const size = sizeMatch ? parseSizeToBytes(sizeMatch[1], sizeMatch[2]) : 0;
          
          const seedMatch = row.match(/class=["']my_tt seed["'][^>]*><b>(\d+)<\/b>/i);
          const seeds = seedMatch ? parseInt(seedMatch[1]) : 0;
          
          const leechMatch = row.match(/class=["']my_tt leech["'][^>]*><b>(\d+)<\/b>/i);
          const leechers = leechMatch ? parseInt(leechMatch[1]) : 0;
          
          debug.trackers.leporno.parsing.itemsParsed++;
          
          if (lepItems.length === 0) {
            debug.trackers.leporno.firstItem = { fileId, title: title.substring(0, 50), size, seeds, leechers };
          }
          
          lepItems.push({ fileId, title, topicId, forumId, size, seeds, leechers });
          if (lepItems.length >= 15) break;
        }
        
        debug.trackers.leporno.totalItems = lepItems.length;
        
        let magnetSuccess = 0;
        await Promise.all(lepItems.map(async item => {
          try {
            const magnetUrl = `https://leporno.de/download/file.php?id=${item.fileId}&magnet=1&confirm=1`;
            const magnetRes = await fetch(magnetUrl, {
              headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://leporno.de/"
              },
              redirect: 'manual'
            });
            
            const location = magnetRes.headers.get('Location');
            const status = magnetRes.status;
            
            if (!debug.trackers.leporno.magnetDebug) {
              debug.trackers.leporno.magnetDebug = {
                fileId: item.fileId,
                status: status,
                hasLocation: !!location,
                locationStart: location ? location.substring(0, 80) : 'NULL'
              };
            }
            
            if (location && location.startsWith('magnet:')) {
              const magnetUri = location;
              const hashMatch = magnetUri.match(/btih:([a-fA-F0-9]{40})/i);
              const hash = hashMatch ? hashMatch[1].toLowerCase() : null;
              
              if (hash && !seen.has(hash)) {
                seen.add(hash);
                magnetSuccess++;
                Results.push({
                  Title: item.title, Seeders: item.seeds, Peers: item.leechers, Size: item.size,
                  Tracker: "LePorno.de", MagnetUri: magnetUri,
                  Link: `https://leporno.de/viewtopic.php?f=${item.forumId}&t=${item.topicId}`,
                  PublishDate: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            if (!debug.trackers.leporno.magnetError) {
              debug.trackers.leporno.magnetError = e.message;
            }
          }
        }));
        
        debug.trackers.leporno.magnetSuccess = magnetSuccess;
      }
      
    } catch (e) { 
      debug.error = e.message; 
    }
    
    Results.sort((a, b) => b.Seeders - a.Seeders);
    return jsonResponse({ Results, Indexers: ["Rutor", "NNMClub", "XXXTor", "LePorno.de"], Total: Results.length, Debug: debug });
  }
};

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
