// Progresso de cada pessoa na nuvem (Vercel Function + Upstash Redis).
// O navegador manda {u, e}: u = identificador anônimo (SHA-256 da senha com outro prefixo),
// e = {prog, resp, quando, zerado}. A função junta com o que já estava salvo
// (por questão, vence a mudança mais recente), grava e devolve o resultado.
// Só aceita identificadores da lista gerada pelo protege.py (_permitidos.json).
const PERMITIDOS = new Set(require('./_permitidos.json'));
const URL_R = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ORIGENS = ['https://axommamed-soi5.vercel.app', 'https://anabeatrizpiresmourao-web.github.io'];

async function redis(cmd) {
  const r = await fetch(URL_R, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

function limpa(e) {
  const o = { prog: {}, resp: {}, quando: {}, zerado: 0 }, agora = Date.now() + 864e5;
  if (!e || typeof e !== 'object') return o;
  const z = Number(e.zerado); o.zerado = z > 0 && z < agora ? z : 0;
  const q = e.quando && typeof e.quando === 'object' ? e.quando : {};
  for (const id of Object.keys(q).slice(0, 2000)) {
    const t = Number(q[id]);
    if (!/^[\w.-]{1,40}$/.test(id) || !(t > 0 && t < agora)) continue;
    o.quando[id] = t;
    const p = e.prog && e.prog[id], l = e.resp && e.resp[id];
    if (p === 'ok' || p === 'erro') o.prog[id] = p;
    if (typeof l === 'string' && /^[A-E]$/.test(l)) o.resp[id] = l;
  }
  return o;
}

function mesclar(a, b) {
  const z = Math.max(a.zerado || 0, b.zerado || 0), o = { prog: {}, resp: {}, quando: {}, zerado: z };
  for (const id of new Set([...Object.keys(a.quando), ...Object.keys(b.quando)])) {
    const ta = a.quando[id] || 0, tb = b.quando[id] || 0, w = ta >= tb ? a : b, t = Math.max(ta, tb);
    if (t <= z) continue;
    o.quando[id] = t;
    if (w.prog[id] != null) o.prog[id] = w.prog[id];
    if (w.resp[id] != null) o.resp[id] = w.resp[id];
  }
  return o;
}

module.exports = async (req, res) => {
  const origem = req.headers.origin;
  if (ORIGENS.includes(origem)) { res.setHeader('Access-Control-Allow-Origin', origem); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
  try {
    let corpo = req.body;
    if (typeof corpo === 'string') { if (corpo.length > 200000) return res.status(413).json({ erro: 'grande demais' }); corpo = JSON.parse(corpo); }
    const u = corpo && corpo.u;
    if (typeof u !== 'string' || !PERMITIDOS.has(u)) return res.status(403).json({ erro: 'acesso não reconhecido' });
    if (!URL_R || !TOKEN) return res.status(503).json({ erro: 'banco não configurado' });
    const chave = 'soi5n2:prog:' + u;
    const salvo = await redis(['GET', chave]);
    const junto = mesclar(limpa(salvo ? JSON.parse(salvo) : null), limpa(corpo.e));
    await redis(['SET', chave, JSON.stringify(junto)]);
    return res.status(200).json(junto);
  } catch (e) {
    return res.status(500).json({ erro: 'falha ao salvar' });
  }
};
