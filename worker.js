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
// 5. ПАРСИНГ LEPORNO.DE (BENCODE + SHA1 HASH CALCULATION)
// ===================================================

/**
 * Минимальный парсер Bencode (только для структуры Torrent файлов)
 * Нужен, чтобы извлечь блок 'info' и вычислить хеш.
 */
function parseBencode(buffer) {
    let pos = 0;
    const view = new Uint8Array(buffer);
    const textDecoder = new TextDecoder('utf-8');

    function readChar() { return String.fromCharCode(view[pos++]); }
    function readUntil(char) {
        let start = pos;
        while (view[pos] !== char.charCodeAt(0)) { pos++; }
        return textDecoder.decode(view.slice(start, pos));
    }
    function readInt() {
        let start = pos;
        while (view[pos] >= 48 && view[pos] <= 57) { pos++; } // 0-9
        return parseInt(textDecoder.decode(view.slice(start, pos)), 10);
    }

    function decodeValue() {
        const char = String.fromCharCode(view[pos]);
        if (char === 'd') { // Dictionary
            pos++;
            const obj = {};
            while (view[pos] !== 101) { // 'e'
                const keyLen = readInt();
                pos++; // skip ':'
                const key = textDecoder.decode(view.slice(pos, pos + keyLen));
                pos += keyLen;
                obj[key] = decodeValue();
            }
            pos++; // skip 'e'
            return obj;
        } else if (char === 'l') { // List
            pos++;
            const arr = [];
            while (view[pos] !== 101) {
                arr.push(decodeValue());
            }
            pos++; // skip 'e'
            return arr;
        } else if (char === 'i') { // Integer
            pos++;
            const val = readInt();
            pos++; // skip 'e'
            return val;
        } else if (char >= '0' && char <= '9') { // String
            const len = readInt();
            pos++; // skip ':'
            const start = pos;
            pos += len;
            return view.slice(start, pos); // Возвращаем как Uint8Array для точности
        }
        throw new Error(`Invalid bencode char: ${char} at ${pos}`);
    }

    return decodeValue();
}

/**
 * Вычисляет SHA-1 хеш для блока info из torrent файла
 */
async function calculateInfoHash(torrentBuffer) {
    try {
        const decoded = parseBencode(torrentBuffer);
        
        // Находим блок 'info' в корне
        if (!decoded.info) {
            throw new Error("No 'info' dictionary found in torrent");
        }

        // Нам нужно получить raw байты блока 'info', чтобы захешировать их.
        // Но наш парсер уже превратил всё в JS объекты. 
        // Хитрость: нам нужно найти смещение 'info' в оригинальном буфере и длину.
        // Однако, простой парсер выше этого не хранит.
        
        // Альтернативный надежный способ для Workers:
        // 1. Находим строку "4:info" в бинарнике.
        // 2. Парсим длину следующего элемента (словаря).
        // 3. Вырезаем кусок байтов и хешируем.
        
        const infoMarker = new TextEncoder().encode("4:info");
        let infoStart = -1;
        
        // Ищем смещение ключа "info"
        for (let i = 0; i < torrentBuffer.byteLength - 10; i++) {
            if (torrentBuffer[i] === 49 && // '1' (если бы было 1:info, но у нас 4:info)
                // Проверка на "4:info"
                torrentBuffer[i] === 52 && // '4'
                torrentBuffer[i+1] === 58 && // ':'
                torrentBuffer[i+2] === 105 && // 'i'
                torrentBuffer[i+3] === 110 && // 'n'
                torrentBuffer[i+4] === 102 && // 'f'
                torrentBuffer[i+5] === 111    // 'o'
                ) {
                    // Нашли "4:info". Теперь нужно понять, где начинается сам словарь и где он кончается.
                    // Формат: d...4:infod{...}e...e
                    // Ключ найден. Значение (словарь) начинается сразу после 'o' (последней буквы info)? 
                    // Нет, в bencode ключ идет за длиной. "4:info" -> длина 4, строка "info".
                    // Следующий символ - это начало значения. Если значение словарь, то 'd'.
                    
                    // Давайте проще: используем готовый подход поиска подстроки "d...4:info"
                    // Но надежнее всего: найти смещение начала словаря info.
                    // В bencode словари начинаются с 'd'.
                    // Структура: ...l...d4:name...4:infod.....ee...
                    // Мы нашли "4:info". Предыдущий символ должен быть ':' или часть длины.
                    // Давайте искать паттерн, где перед "4:info" стоит цифра (длина ключа).
                    // Обычно это просто "4:info".
                    
                    // Точный алгоритм поиска начала блока info:
                    // 1. Найти "4:info".
                    // 2. Сдвинуться на 6 байт вперед (длина "4:info").
                    // 3. Там должен быть 'd' (начало словаря info).
                    const dictStart = i + 6; 
                    if (torrentBuffer[dictStart] === 100) { // 'd'
                        infoStart = dictStart;
                        break;
                    }
            }
        }

        if (infoStart === -1) throw new Error("Could not locate 'info' dictionary start");

        // Теперь нужно найти конец этого словаря. 
        // Считаем вложенность 'd' и 'e'.
        let depth = 0;
        let infoEnd = -1;
        for (let i = infoStart; i < torrentBuffer.byteLength; i++) {
            if (torrentBuffer[i] === 100) depth++; // 'd'
            else if (torrentBuffer[i] === 101) { // 'e'
                depth--;
                if (depth === 0) {
                    infoEnd = i + 1;
                    break;
                }
            }
        }

        if (infoEnd === -1) throw new Error("Could not locate end of 'info' dictionary");

        const infoSlice = torrentBuffer.slice(infoStart, infoEnd);
        
        // Вычисляем SHA-1
        const hashBuffer = await crypto.subtle.digest('SHA-1', infoSlice);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
    } catch (e) {
        console.error("Error calculating hash:", e);
        return null;
    }
}

const lePornoResults = [];

if (lepornoHtml) {
    const tableMatch = lepornoHtml.match(/<table[^>]*class=["']forumline["'][^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
        const tableHtml = tableMatch[1];
        const rows = [...tableHtml.matchAll(/<tr\s+valign=["']middle["'][^>]*>([\s\S]*?)<\/tr>/gi)];
        
        console.log(`[LePorno] Найдено строк для обработки: ${rows.length}`);

        // Используем Promise.all для параллельной загрузки торрентов
        const promises = rows.map(async (rowMatch) => {
            const html = rowMatch[1];
            try {
                // --- А. Название и Ссылка на топик ---
                const titleMatch = html.match(/class=["']topictitle["'][^>]*>([\s\S]*?)<\/a>/i);
                const topicLinkMatch = html.match(/href=["'](viewtopic\.php\?f=\d+&amp;t=\d+[^"']*)["']/i);
                
                if (!titleMatch || !topicLinkMatch) return null;

                let title = titleMatch[1]
                    .replace(/<[^>]+>/g, '').replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '').trim()
                    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
                
                const topicHref = topicLinkMatch[1].replace(/&amp;/g, '&');
                const fullTopicLink = `https://leporno.de/${topicHref}`;
                const topicId = topicHref.match(/t=(\d+)/)?.[1] || '';

                // --- Б. Ссылка на .torrent файл ---
                // Ищем ссылку на download.php?id=...
                // Обычно это img с alt="Download" или прямая ссылка рядом
                const torrentLinkMatch = html.match(/href=["'](\.\/download\.php\?id=\d+[^"']*)["']/i);
                
                if (!torrentLinkMatch) {
                    console.warn(`[LePorno] Не найдена ссылка на торрент для: ${title}`);
                    return null;
                }

                const torrentFileUrl = `https://leporno.de/${torrentLinkMatch[1].replace(/&amp;/g, '&')}`;

                // --- В. Размер, Сиды, Пиры (из HTML списка) ---
                const sizeContainer = html.match(/class=["']gensmall["'][^>]*>([\s\S]*?)<\/p>/i);
                let sizeBytes = 0;
                if (sizeContainer) {
                    const sizeMatch = sizeContainer[1].match(/Размер:\s*<b>([\d.,]+)\s*&nbsp;\s*(GB|MB|KB|ГБ|МБ|КБ)<\/b>/i);
                    if (sizeMatch) {
                        const multipliers = { 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'КБ': 1024, 'МБ': 1024**2, 'ГБ': 1024**3 };
                        const val = parseFloat(sizeMatch[1].replace(',', '.'));
                        const unit = sizeMatch[2].toUpperCase().replace('Г', 'G').replace('М', 'M').replace('К', 'K');
                        sizeBytes = Math.round(val * (multipliers[unit] || 1));
                    }
                }

                const seedsCellMatch = html.match(/<span\s+class=["']my_tt\s+seed["'][^>]*><b>(\d+)<\/b>/i);
                const leechCellMatch = html.match(/<span\s+class=["']my_tt\s+leech["'][^>]*><b>(\d+)<\/b>/i);
                const seeders = seedsCellMatch ? parseInt(seedsCellMatch[1]) : 0;
                const peers = leechCellMatch ? parseInt(leechCellMatch[1]) : 0;

                // --- Г. ГЛАВНОЕ: Скачиваем торрент и считаем хеш ---
                // Делаем fetch внутри Worker'а
                const torrentResponse = await fetch(torrentFileUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LePornoBot/1.0)' }
                });

                if (!torrentResponse.ok) {
                    console.warn(`[LePorno] Ошибка загрузки торрента ${topicId}: ${torrentResponse.status}`);
                    return null;
                }

                const torrentArrayBuffer = await torrentResponse.arrayBuffer();
                const infoHash = await calculateInfoHash(torrentArrayBuffer);

                if (!infoHash) {
                    console.warn(`[LePorno] Не удалось вычислить хеш для ${topicId}`);
                    return null;
                }

                // Формируем настоящий Magnet URI
                // magnet:?xt=urn:btih:<HASH>&dn=<NAME>&tr=<TRACKER>
                // Трейкеры обычно указаны внутри torrent файла, но для магнета можно добавить announce URL трекера, если известен.
                // Для Leporno announce URL часто выглядит как http://leporno.de/announce.php?passkey=... (но passkey у нас нет)
                // Поэтому оставляем только xt (hash) и dn (name). Клиент сам найдет пиров через DHT.
                
                const magnetUri = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;

                return {
                    Title: title,
                    Seeders: seeders,
                    Peers: peers,
                    Size: sizeBytes,
                    Tracker: "LePorno",
                    MagnetUri: magnetUri, // Чистый магнет
                    Link: fullTopicLink,
                    PublishDate: new Date().toISOString()
                };

            } catch (e) {
                console.error(`[LePorno] Ошибка обработки строки:`, e.message);
                return null;
            }
        });

        // Ждем завершения всех загрузок и вычислений
        const results = await Promise.all(promises);
        lePornoResults.push(...results.filter(r => r !== null));
    }
}

Results.push(...lePornoResults);
console.log(`[LePorno] Итоговый результат: ${lePornoResults.length} рабочих магнетов.`);


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
