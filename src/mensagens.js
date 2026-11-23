import { normalizeMessageContent } from "baileys";
import { cfg, ehDono, soNumero, prefixoUsado, prefixosExtras } from "./lib/config.js";
import { grupo, salvarGrupo } from "./lib/banco.js";
import { t } from "./lib/textos.js";
import { respostaDeBotao } from "./lib/botoes.js";
import { COMANDOS } from "./comandos/index.js";
import { grupoAtivo } from "./lib/aluguel.js";
import { convivencia, votoEnquete } from "./rpg/ganchos.js";

const metas = new Map();
const LINK = /(chat\.whatsapp\.com\/|wa\.me\/|https?:\/\/|www\.)/i;

export const esquecerGrupo = (jid) => metas.delete(jid);

export const metaEmCache = (jid) => metas.get(jid)?.meta;

const APOSTAS_CMDS = new Set(["apostar", "aposta", "bet", "cassino", "caixas", "caixamisteriosa", "abrircaixa", "lootbox"]);
const recargas = new Map();
function recargaDe(def) {
  if (def.nomes.some((n) => APOSTAS_CMDS.has(n))) return { tipo: "apostas", ms: 10_000, nome: "as apostas" };
  if (def.categoria === "brincadeiras") return { tipo: "brincadeiras", ms: 20_000, nome: "as brincadeiras" };
  return null;
}

export async function metaDoGrupo(sock, jid) {
  const c = metas.get(jid);
  if (c && Date.now() - c.em < 60_000) return c.meta;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (meta) metas.set(jid, { meta, em: Date.now() });
  return meta;
}

export const hoje = () => new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function idsDoMembro(meta, ...ids) {
  const p = participante(meta, ...ids);
  return [...new Set([...ids, p?.id, p?.jid, p?.lid, p?.phoneNumber].filter(Boolean).map(soNumero).filter(Boolean))];
}

export function parceiroDe(g, ids) {
  return Object.entries(g.parceiros || {}).find(([, v]) => (v.ids || []).some((i) => ids.includes(i))) || null;
}

export const naListaNegra = (g, ids) => (g.listanegra || []).some((n) => ids.includes(n));

const idsDe = (p) => [p?.id, p?.jid, p?.lid, p?.phoneNumber].filter(Boolean).map(soNumero);

export function participante(meta, ...ids) {
  const alvo = ids.map(soNumero).filter(Boolean);
  return (meta?.participants || []).find((p) => idsDe(p).some((i) => alvo.includes(i))) || null;
}

const enviadas = new Set();
export function marcarEnviada(id) {
  if (!id) return;
  enviadas.add(id);
  if (enviadas.size > 3000) for (const k of [...enviadas].slice(0, 1000)) enviadas.delete(k);
}

function textoDa(msg) {
  const dentro = normalizeMessageContent(msg.message) || {};
  return respostaDeBotao(dentro) || dentro.conversation || dentro.extendedTextMessage?.text || dentro.imageMessage?.caption || dentro.videoMessage?.caption || "";
}

function marcados(msg) {
  const m = normalizeMessageContent(msg.message) || {};
  const ctx = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || {};
  return { mencoes: ctx.mentionedJid || [], citado: ctx.participant || null, ctx };
}

async function advertir(sock, jid, g, quem, msg) {
  const max = Number(cfg().maxAdv) || 3;
  const k = soNumero(quem);
  g.advs[k] = (g.advs[k] || 0) + 1;
  salvarGrupo();
  if (g.advs[k] >= max) {
    delete g.advs[k];
    salvarGrupo();
    await sock.groupParticipantsUpdate(jid, [quem], "remove").catch(() => {});
    return sock.sendMessage(jid, { text: t("advBan", { user: k, max }), mentions: [quem] });
  }
  return sock.sendMessage(jid, { text: t("adv", { user: k, n: g.advs[k], max }), mentions: [quem] }, { quoted: msg });
}

export async function aoReceber(sock, msg) {
  if (!msg.message) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  if (msg.key.fromMe && enviadas.has(msg.key.id)) return;

  const isGroup = jid.endsWith("@g.us");
  const eu = sock.user?.id ? `${soNumero(sock.user.id)}@s.whatsapp.net` : "";
  const autor = msg.key.fromMe ? eu : isGroup ? (msg.key.participant || msg.participant || "") : jid;
  if (!autor) return;
  const autorAlt = msg.key.participantPn || msg.key.senderPn || msg.key.participantAlt || msg.key.remoteJidAlt || "";
  const texto = textoDa(msg).trim();
  const c = cfg();
  const prefixo = c.prefixo || "#";
  const usado = prefixoUsado(texto);
  let isDono = msg.key.fromMe || ehDono(autor, autorAlt);

  let meta = null, isAdmin = false, isBotAdmin = false, g = null;
  const ativo = !isGroup || grupoAtivo(jid);
  if (isGroup && !isDono) {
    meta = await metaDoGrupo(sock, jid);
    isDono = ehDono(...idsDoMembro(meta, autor, autorAlt));
  }
  if (isGroup && ativo) {
    meta ||= await metaDoGrupo(sock, jid);
    g = grupo(jid);
    const quem = participante(meta, autor, autorAlt);
    isAdmin = Boolean(quem?.admin) || isDono;
    const bot = participante(meta, sock.user?.id, sock.user?.lid);
    isBotAdmin = Boolean(bot?.admin);

    const meusIds = idsDoMembro(meta, autor, autorAlt);
    if (!isAdmin && isBotAdmin && naListaNegra(g, meusIds)) {
      await sock.groupParticipantsUpdate(jid, [autor], "remove").catch(() => {});
      return sock.sendMessage(jid, { text: t("listaNegraRemovido", { user: soNumero(autor) }), mentions: [autor] });
    }

    if (!isAdmin && texto) {
      if (g.antilink && g.parceria && LINK.test(texto)) {
        const par = parceiroDe(g, meusIds);
        if (par) {
          const [, v] = par;
          if (v.dia !== hoje()) { v.dia = hoje(); v.usados = 0; }
          if (v.usados < v.limite) {
            v.usados++;
            salvarGrupo();
            return sock.sendMessage(jid, { text: t("parceriaLiberada", { user: soNumero(autor), usados: v.usados, limite: v.limite }), mentions: [autor] }, { quoted: msg });
          }
        }
      }
      if (g.antilink && LINK.test(texto)) {
        if (isBotAdmin) await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
        await sock.sendMessage(jid, { text: t("antilink", { user: soNumero(autor) }), mentions: [autor] });
        if (isBotAdmin) await advertir(sock, jid, g, autor, msg);
        return;
      }
      if (g.antipalavrao && g.palavras.length) {
        const baixo = texto.toLowerCase();
        if (g.palavras.some((p) => baixo.includes(p))) {
          if (isBotAdmin) await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
          await sock.sendMessage(jid, { text: t("palavrao", { user: soNumero(autor) }), mentions: [autor] });
          if (isBotAdmin) await advertir(sock, jid, g, autor, msg);
          return;
        }
      }
    }
  }

  if (isGroup && ativo && !msg.key.fromMe) {
    const bruto = normalizeMessageContent(msg.message) || {};
    if (bruto.pollUpdateMessage) return votoEnquete(sock, msg, bruto);
    const nomeCmd = usado ? texto.slice(usado.length).trim().split(/\s+/)[0].toLowerCase() : "";
    const consumiu = await convivencia({
      sock, msg, jid, autor, nome: msg.pushName || "", texto, meta, prefixo,
      ehComando: Boolean(nomeCmd && COMANDOS.has(nomeCmd)),
      mencionados: marcados(msg).mencoes,
    }).catch((e) => { console.error("[rpg]", e.message); return false; });
    if (consumiu) return;
  }

  if (!usado && /^prefixo$/i.test(texto) && !msg.key.fromMe && (!isGroup || ativo)) return sock.sendMessage(jid, { text: `🔣 Meu prefixo é *${prefixo}*${c.multiprefixo ? `\nTambém aceito: ${prefixosExtras().join(" ")}` : ""}\nEx: ${prefixo}menu` }, { quoted: msg });
  if (!usado) return;
  const [nome, ...args] = texto.slice(usado.length).trim().split(/\s+/);
  const cmd = (nome || "").toLowerCase();
  if (!cmd) return;
  const def = COMANDOS.get(cmd);
  if (!ativo && !isDono && !def?.semAluguel) {
    return sock.sendMessage(jid, { text: t("semAluguel", { p: prefixo }) }, { quoted: msg });
  }
  if (isGroup && !g) {
    meta ||= await metaDoGrupo(sock, jid);
    g = grupo(jid);
    isAdmin = Boolean(participante(meta, autor, autorAlt)?.admin) || isDono;
    isBotAdmin = Boolean(participante(meta, sock.user?.id, sock.user?.lid)?.admin);
  }
  console.log(`📩 ${prefixo}${cmd} · ${soNumero(autorAlt || autor)} · ${isGroup ? (meta?.subject || "grupo") : "privado"}`);
  const { mencoes, citado, ctx } = marcados(msg);

  const contexto = {
    sock, msg, jid, isGroup, autor, autorAlt, args, cmd, prefixo, meta, g, isAdmin, isBotAdmin, isDono,
    texto: args.join(" "),
    autorNum: soNumero(autorAlt || autor),
    citadoMsg: ctx.quotedMessage || null,
    reply: (txt, mentions = []) => sock.sendMessage(jid, { text: txt, mentions }, { quoted: msg }),
    react: (e) => sock.sendMessage(jid, { react: { text: e, key: msg.key } }).catch(() => {}),
    alvo: () => {
      if (mencoes[0]) return mencoes[0];
      if (citado) return citado;
      const n = soNumero(args.join(""));
      return n.length >= 10 ? `${n}@s.whatsapp.net` : null;
    },
    salvarGrupo,
    idsDe: (j) => idsDoMembro(meta, j),
    advertir: (quem) => advertir(sock, jid, g, quem, msg),
  };

  if (!def) return contexto.reply(t("naoEncontrado"));
  if (def.dono && !isDono) return contexto.reply(t("soDono"));
  if (def.grupo && !isGroup) return contexto.reply(t("soGrupo"));
  if (def.admin && !isAdmin) return contexto.reply(t("soAdmin"));
  if (def.botAdmin && !isBotAdmin) return contexto.reply(t("botAdmin"));
  if (isGroup && g.soadm && !isAdmin && !def.livre) return contexto.reply(t("soAdmModo"));
  const r = recargaDe(def);
  if (r && !isAdmin && !isDono) {
    const k = `${jid}|${autor}|${r.tipo}`;
    const agora = Date.now();
    const st = recargas.get(k);
    if (st && st.ate > agora) {
      if (st.avisou) return;
      st.avisou = true;
      return contexto.reply(`⏳ Espere *${Math.ceil((st.ate - agora) / 1000)}s* para usar ${r.nome} de novo.`);
    }
    recargas.set(k, { ate: agora + r.ms, avisou: false });
    if (recargas.size > 5000) for (const [kk, v] of recargas) if (v.ate < agora) recargas.delete(kk);
  }

  try {
    await def.run(contexto);
  } catch (e) {
    console.error(`[${cmd}]`, e.message);
    contexto.reply(t("erro"));
  }
}
