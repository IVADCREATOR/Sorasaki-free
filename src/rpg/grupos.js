export const usuario = (jid) => String(jid || "").split("@")[0].split(":")[0];

const cache = new Map();
const VALIDADE = 3 * 60 * 1000;

export function limparCacheGrupo(jid) { cache.delete(jid); }
export function metaEmCache(jid, maxMs = 60_000) { const c = cache.get(jid); return c && Date.now() - c.em < maxMs ? c.meta : undefined; }

export async function metadados(sock, jid, { fresco = false } = {}) {
  const c = cache.get(jid);
  if (!fresco && c && Date.now() - c.em < VALIDADE) return c.meta;
  try {
    const meta = await sock.groupMetadata(jid);
    cache.set(jid, { meta, em: Date.now() });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return meta;
  } catch {
    return c?.meta || null;
  }
}

export function idsDoParticipante(p) {
  return [p?.id, p?.lid, p?.jid, p?.phoneNumber].map(usuario).filter(Boolean);
}
export function idsDoBot(sock) {
  return [sock?.user?.id, sock?.user?.lid].map(usuario).filter(Boolean);
}
export function idsDoAutor(msg) {
  const k = msg?.key || {};
  return [k.participant, k.participantPn, k.participantAlt, k.participantLid, msg?.participant, k.fromMe ? null : (k.remoteJid?.endsWith("@g.us") ? null : k.remoteJid), k.senderPn, k.senderLid]
    .map(usuario).filter(Boolean);
}

export function participante(meta, ids) {
  const alvo = new Set(ids);
  return (meta?.participants || []).find((p) => idsDoParticipante(p).some((i) => alvo.has(i))) || null;
}
export function jidDoNumero(meta, n) {
  const p = participante(meta, [String(n)]);
  return p?.id || (String(n).length > 13 ? `${n}@lid` : `${n}@s.whatsapp.net`);
}
export const ehAdminP = (p) => Boolean(p && (p.admin === "admin" || p.admin === "superadmin"));

export function admins(meta) {
  return (meta?.participants || []).filter(ehAdminP);
}

export function alvos(msg, meta, args = []) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo || {};
  const lista = [...(ctx.mentionedJid || [])];
  if (ctx.participant) lista.push(ctx.participant);
  for (const a of args) {
    const n = String(a).replace(/\D/g, "");
    if (n.length >= 8 && n.length <= 20) lista.push(`${n}@s.whatsapp.net`);
  }
  const achados = [];
  for (const j of lista) {
    const p = participante(meta, [usuario(j)]);
    const id = p?.id || j;
    if (!achados.includes(id)) achados.push(id);
  }
  return achados;
}
