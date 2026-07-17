// gateway/websearch.js
// Búsqueda web gratuita vía DuckDuckGo (sin API key).
// No hay endpoint JSON oficial completo, así que parseamos el HTML de resultados.

const fetch = require('node-fetch');
const cheerio = require('cheerio');

async function webSearchDuckDuckGo(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo respondió con estado ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];

  $('.result').each((i, el) => {
    if (results.length >= maxResults) return;
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const rawLink = $(el).find('.result__url').attr('href') || $(el).find('a.result__a').attr('href');

    if (title) {
      results.push({ title, snippet, url: rawLink || null });
    }
  });

  return results;
}

// Formatea los resultados como contexto para inyectar en el prompt del modelo
function formatResultsAsContext(query, results) {
  if (!results.length) {
    return `Búsqueda web para "${query}": no se encontraron resultados.`;
  }
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}${r.url ? `\n(${r.url})` : ''}`);
  return `Resultados de búsqueda web para "${query}" (usa esta información para responder si es relevante, y menciona que la obtuviste de una búsqueda reciente):\n\n${lines.join('\n\n')}`;
}

module.exports = { webSearchDuckDuckGo, formatResultsAsContext };
