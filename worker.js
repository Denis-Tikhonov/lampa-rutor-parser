export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    if (!query) return jsonResponse({ Results: [] });

    try {
      const searchUrl = `https://pornolab.net/forum/search.php?keywords=${encodeURIComponent(query)}`;

      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Cookie": "your_cookie_here" // Замените на актуальные куки
        }
      });

      if (!response.ok) {
        return jsonResponse({ Results: [], error: `HTTP ${response.status}` });
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const Results = [];

      // Парсинг таблицы с результатами
      doc.querySelectorAll("table.forumline tr:not(:first-child)").forEach(row => {
        const title = row.querySelector("td.row1 a")?.textContent.trim();
        const sizeText = row.querySelector("td.row2")?.textContent.trim();
        const seeders = parseInt(row.querySelector("td.row3")?.textContent.trim()) || 0;
        const peers = parseInt(row.querySelector("td.row4")?.textContent.trim()) || 0;

        // Поиск magnet-ссылки (в Pornolab она может быть скрыта)
        let magnet = "";
        const magnetLink = row.querySelector("a[href^='magnet:']");
        if (magnetLink) {
          magnet = magnetLink.href;
        } else {
          // Альтернативный поиск в тексте
          const magnetMatch = row.textContent.match(/magnet:\?[^&\s]+/);
          magnet = magnetMatch ? magnetMatch[0] : "";
        }

        Results.push({
          Title: title,
          Seeders: seeders,
          Peers: peers,
          Size: parseSizeToBytes(sizeText),
          MagnetUri: magnet,
          Link: "https://pornolab.net" + row.querySelector("td.row1 a")?.href,
          Tracker: "Pornolab"
        });
      });

      // Сортировка по сидам
      Results.sort((a, b) => b.Seeders - a.Seeders);

      return jsonResponse({
        Results,
        Indexers: ["Pornolab"],
        meta: { query, found: Results.length }
      });

    } catch (e) {
      return jsonResponse({ Results: [], error: e.message });
    }
  }
};

// Вспомогательные функции (остаются без изменений)
function parseSizeToBytes(sizeText) {
  const match = sizeText.match(/([\d.,]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB)/i);
  if (!match) return 0;
  const n = parseFloat(match[1].replace(/,/g, '.'));
  const u = match[2].toUpperCase().replace('IB', 'B');
  switch (u) {
    case "TB": return Math.round(n * 1024 ** 4);
    case "GB": return Math.round(n * 1024 ** 3);
    case "MB": return Math.round(n * 1024 ** 2);
    case "KB": return Math.round(n * 1024);
    default:   return 0;
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
