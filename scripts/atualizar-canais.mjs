// Baixa as listas públicas do iptv-org, testa cada canal e grava só os que estão no ar em lista/.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://iptv-org.github.io/iptv/';
const CATEGORIAS = ['movies','series','entertainment','animation','kids','news','sports','documentary','music'];
const PAISES = ['br','pt','ao','mz','cv','gw','st','tl'];
const LISTAS = ['categories/xxx.m3u', ...CATEGORIAS.map(c => `categories/${c}.m3u`), ...PAISES.map(c => `countries/${c}.m3u`), 'languages/por.m3u'];
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const LIMITE = 10000, PARALELO = 64;

function blocos(texto) {
  const out = []; let atual = null;
  for (const raw of texto.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#EXTINF')) atual = { linhas: [l], url: '', ref: '' };
    else if (atual && l.startsWith('#')) { atual.linhas.push(l); const m = l.match(/http-referrer=(\S+)/); if (m) atual.ref = m[1]; }
    else if (atual) { atual.url = l; atual.geo = /geo-?blocked/i.test(atual.linhas[0]); out.push(atual); atual = null; }
  }
  return out;
}

async function testar(url, ref) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), LIMITE);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, ...(ref ? { Referer: ref } : {}) } });
    if (!r.ok || !r.body) return false;
    const tipo = (r.headers.get('content-type') || '').toLowerCase();
    const leitor = r.body.getReader(); const { value } = await leitor.read(); leitor.cancel().catch(() => {});
    const inicio = value ? Buffer.from(value.slice(0, 64)).toString('utf8') : '';
    return inicio.includes('#EXTM3U') || /video|mpegurl|octet-stream|mp2t/.test(tipo);
  } catch { return false; } finally { clearTimeout(t); }
}

const listas = {};
for (const p of LISTAS) {
  try { const r = await fetch(BASE + p); if (r.ok) listas[p] = blocos(await r.text()); else console.log('sem lista', p, r.status); }
  catch (e) { console.log('falhou baixar', p, e.message); }
}
// Só canais em português: a lista de idioma define o que entra no app.
const emPortugues = new Set((listas['languages/por.m3u'] || []).map(b => b.url));
if (!emPortugues.size) { console.log('Lista de idioma indisponível; nada foi alterado.'); process.exit(1); }
for (const p of Object.keys(listas)) listas[p] = listas[p].filter(b => emPortugues.has(b.url));
const unicos = new Map();
for (const b of Object.values(listas).flat()) if (!unicos.has(b.url)) unicos.set(b.url, b);
console.log(`Testando ${unicos.size} canais…`);

const status = new Map(); const fila = [...unicos.values()]; let feitos = 0;
await Promise.all(Array.from({ length: PARALELO }, async () => {
  while (fila.length) {
    const b = fila.pop();
    status.set(b.url, b.geo || await testar(b.url, b.ref));
    if (++feitos % 500 === 0) console.log(`${feitos}/${unicos.size}`);
  }
}));

let online = 0; for (const v of status.values()) if (v) online++;
for (const [p, bs] of Object.entries(listas)) {
  const vivos = bs.filter(b => status.get(b.url));
  const arq = 'lista/' + p; await mkdir(dirname(arq), { recursive: true });
  await writeFile(arq, '#EXTM3U\n' + vivos.map(b => b.linhas.join('\n') + '\n' + b.url).join('\n') + '\n');
}
await writeFile('lista/atualizado.json', JSON.stringify({ data: new Date().toISOString(), testados: unicos.size, online }, null, 2));
console.log(`Pronto: ${online} de ${unicos.size} canais no ar.`);
