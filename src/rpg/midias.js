import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import { mencoesDoTexto } from "./util.js";
import { MIDIAS } from "./midias-lista.js";

export const PASTA_MIDIAS = path.join(CONFIG.pastas.storage, "zoeira");
export const EXTENSOES = { img: ["jpg", "jpeg", "png", "webp"], vid: ["mp4"] };
const TETO_BYTES = 12 * 1024 * 1024;
const ESPERA_MS = 12_000;
const CASTIGO_MS = 6 * 3600_000;
const falhas = new Map();

export const temMidia = (chave) => Boolean(MIDIAS[chave]);

function arquivoLocal(chave, tipo) {
  for (const ext of EXTENSOES[tipo] || []) {
    const arq = path.join(PASTA_MIDIAS, `${chave}.${ext}`);
    try { if (fs.statSync(arq).size > 0) return arq; } catch {}
  }
  return null;
}

async function baixar(url) {
  const quando = falhas.get(url);
  if (quando && Date.now() - quando < CASTIGO_MS) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    const tipo = String(r.headers.get("content-type") || "");
    if (!r.ok || /text\/html|json/i.test(tipo)) throw new Error(`HTTP ${r.status} ${tipo}`);
    if (Number(r.headers.get("content-length")) > TETO_BYTES) throw new Error("grande demais");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024 || buf.length > TETO_BYTES) throw new Error(`tamanho ${buf.length}`);
    falhas.delete(url);
    return buf;
  } catch {
    falhas.set(url, Date.now());
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function midia(chave) {
  const m = MIDIAS[chave];
  if (!m) return null;
  const [tipo, ...urls] = m;
  const local = arquivoLocal(chave, tipo);
  if (local) {
    try { return { tipo, dado: fs.readFileSync(local) }; } catch {}
  }
  for (const u of urls) {
    const dado = await baixar(u);
    if (dado) return { tipo, dado };
  }
  return null;
}

export async function enviarComMidia(c, chave, texto, mencoes = []) {
  const mentions = mencoes.length ? mencoes : mencoesDoTexto(texto, c.meta);
  const m = await midia(chave).catch(() => null);
  if (m) {
    const conteudo = m.tipo === "vid"
      ? { video: m.dado, gifPlayback: true, caption: texto, mentions }
      : { image: m.dado, caption: texto, mentions };
    try {
      await c.sock.sendMessage(c.jid, conteudo, { quoted: c.msg });
      return true;
    } catch {}
  }
  await c.responder(texto, mentions);
  return false;
}
