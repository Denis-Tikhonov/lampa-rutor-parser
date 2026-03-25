export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    if (!query) return jsonResponse({ Results: [], error: "No query provided" });

    try {
      const searchUrl = `https://pornolab.net/forum/search.php?keywords=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://pornolab.net/",
          "Cookie": "your_cookie_here" // Замените на актуальные куки из браузера
        },
        // Используйте прокси, если сайт блокирует ваш IP
        // cf: { // Для обхода Cloudflare (требуется Workers с поддержкой CF)
        //   cacheTtl: 30,
        //   cacheEverything: true,
        // }
      });

      if (!response.ok) {
        return jsonResponse({
          Results: [],
          error: `HTTP ${response.status}`,
          details: await response.text().catch(() => "No response body")
        });
      }

      const html = await response.text();

      // Проверка на CAPTCHA или редирект на вход
      if (html.includes("CAPTCHA") || html.includes("login")) {
        return jsonResponse({
          Results: [],
          error: "CAPTCHA or login required",
          details: "Check cookies or use a browser-based solution"
        });
      }

      const doc = new DOMParser().parseFromString(html, "text/html");
      const Results = [];

      // Попробуем несколько вариантов селекторов (на случай изменений в разметке)
      const tables = doc.querySelectorAll("table.forumline, table[class*='search'], table[class*='topics']");
      if (tables.length === 0) {
        return jsonResponse({
          Results: [],
          error: "No results table found",
          details: "HTML structure may have changed"
        });
      }

      // Парсинг строк таблицы
      tables.forEach(table => {
        table.querySelectorAll("tr").forEach((row, index) => {
          if (index === 0) return; // Пропускаем заголовок таблицы

          const titleCell = row.querySelector("td:first-child, td.row1, td[class*='topic']");
          const title = titleCell?.querySelector("a")?.textContent?.trim();
          if (!title) return;

          const sizeText = row.querySelector("td:nth-child(2), td.row2, td[class*='size']")?.textContent?.trim() || "";
          const seeders = parseInt(row.querySelector("td:nth-child(3), td.row3, td[class*='seed']")?.textContent?.trim()) || 0;
          const peers = parseInt(row.querySelector("td:nth-child(4), td.row4, td[class*='peer']")?.textContent?.trim()) || 0;

          // Поиск magnet-ссылки (пробуем несколько вариантов)
          let magnet = "";
          const magnetLink = row.querySelector("a[href^='magnet:'], a[onclick*='magnet:'], a[class*='magnet']");
          if (magnetLink) {
            magnet = magnetLink.href || magnetLink.getAttribute("onclick")?.match(/magnet:[^'"]+/)?.[0] || "";
          } else {
            // Если magnet скрыт в кнопке или JS
            const button = row.querySelector("button, input[type='button']");
            if (button) {
              const onclick = button.getAttribute("onclick");
              if (onclick) {
                const match = onclick.match(/magnet:[^'"]+/);
                magnet = match ? match[0] : "";
              }
            }
          }

          // Поиск ссылки на торрент (если magnet не найден)
          const torrentLink = row.querySelector("a[href*='viewtopic.php?t='], a[href*='download.php']")?.href;
          const fullLink = torrentLink ? `https://pornolab.net${torrentLink.startsWith('/') ? '' : '/'}${torrentLink}` : "";

          Results.push({
            Title: title,
            Seeders: seeders,
            Peers: peers,
            Size: parseSizeToBytes(sizeText),
            MagnetUri: magnet || "",
            Link: fullLink,
            Tracker: "Pornolab"
          });
        });
      });

      // Сортировка по сидам (по убыванию)
      Results.sort((a, b) => b.Seeders - a.Seeders);

      return jsonResponse({
        Results,
        Indexers: ["Pornolab"],
        meta: { query, found: Results.length }
      });

    } catch (e) {
      return jsonResponse({
        Results: [],
        error: e.message,
        stack: process.env.NODE_ENV === "development" ? e.stack : undefined
      });
    }
  }
};

// Вспомогательные функции
function parseSizeToBytes(sizeText) {
  if (!sizeText) return 0;
  const match = sizeText.match(/([\d.,]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)/i);
  if (!match) return 0;
  const n = parseFloat(match[1].replace(/,/g, '.'));
  const u = match[2].toUpperCase().replace('IB', 'B');
  const units = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024, B: 1 };
  return Math.round(n * (units[u] || 1));
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
