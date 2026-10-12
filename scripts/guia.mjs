// Guia de programação (o que está passando agora).
// Uso: node scripts/guia.mjs canais   -> gera guia/canais.xml para o coletor do iptv-org/epg
//      node scripts/guia.mjs converter -> lê guia/guide.xml e grava guia/agora.json (próximas 36 h)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const modo = process.argv[2];
await mkdir('guia', { recursive: true });

if (modo === 'canais') {
  // Canais que o app mostra: todos os tvg-id das listas em português + clássicos.
  const texto = await readFile('lista/languages/por.m3u', 'utf8').catch(() => '');
  const ids = new Set([...texto.matchAll(/tvg-id="([^"]+)"/g)].map(m => m[1]).filter(Boolean));
  const guias = await (await fetch('https://iptv-org.github.io/api/guides.json')).json();
  const escolhido = new Map();
  for (const g of guias) {
    for (const id of ids) {
      const [canal, feed] = id.split('@');
      if (g.channel !== canal || (g.feed && feed && g.feed !== feed)) continue;
      const atual = escolhido.get(id);
      if (!atual || (g.lang === 'pt' && atual.lang !== 'pt')) escolhido.set(id, g);
    }
  }
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const linhas = [...escolhido].map(([id, g]) =>
    `  <channel site="${esc(g.site)}" lang="${esc(g.lang)}" xmltv_id="${esc(id)}" site_id="${esc(g.site_id)}">${esc(g.site_name)}</channel>`);
  await writeFile('guia/canais.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<channels>\n${linhas.join('\n')}\n</channels>\n`);
  console.log(`Canais com guia disponível: ${escolhido.size} de ${ids.size}.`);
}

if (modo === 'converter') {
  const xml = await readFile('guia/guide.xml', 'utf8').catch(() => '');
  const ent = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
  const data = s => { const m = s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-]\d{4})?/); if (!m) return NaN;
    const off = m[7] ? (m[7][0] === '-' ? -1 : 1) * (parseInt(m[7].slice(1, 3)) * 60 + parseInt(m[7].slice(3))) : 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - off * 60000; };
  const agora = Date.now(), limite = agora + 36 * 3600e3, saida = {};
  for (const m of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
    const at = k => (m[1].match(new RegExp(k + '="([^"]*)"')) || [])[1];
    const ini = data(at('start') || ''), fim = data(at('stop') || ''), canal = at('channel');
    if (!canal || !(fim > agora) || !(ini < limite)) continue;
    const titulo = ent((m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
    if (!titulo) continue;
    (saida[canal] ||= []).push([Math.round(ini / 60000), Math.round(fim / 60000), titulo]);
  }
  for (const k in saida) saida[k].sort((a, b) => a[0] - b[0]);
  await writeFile('guia/agora.json', JSON.stringify({ gerado: new Date().toISOString(), canais: saida }));
  console.log(`Guia gravado para ${Object.keys(saida).length} canais.`);
}
