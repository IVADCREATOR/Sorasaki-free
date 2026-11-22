import { t } from "../lib/textos.js";
import path from "node:path";
import { CONFIG } from "./config.js";
import { lerJson, salvarJson } from "./arquivo.js";
import { usuario, alvos, participante, jidDoNumero } from "./grupos.js";
import { grupo, salvarGrupo } from "./dados.js";
import { inteiro } from "./sorte.js";

const PASTA = path.join(CONFIG.pastas.dados, "niveis");
const arquivoDo = (jid) => path.join(PASTA, `${jid}.json`);
const ESPERA_XP = 60_000;
const XP_MENSAGEM = [4, 9];
const ESPERA_REP = 12 * 3600_000;

const PATENTES = [
  [0, "Visitante", "🌱"], [5, "Membro", "🔰"], [10, "Frequentador", "🎐"], [18, "Veterano", "⚔️"],
  [28, "Guardião", "🛡️"], [40, "Sentinela da Hina", "🌸"], [55, "Elite Sorasaki", "💠"], [75, "Lenda IVAD", "👑"]
];
export function patente(nivel) {
  let atual = PATENTES[0];
  for (const p of PATENTES) if (nivel >= p[0]) atual = p;
  return { nome: atual[1], emoji: atual[2] };
}
export const xpDoNivel = (n) => Math.round(60 * n + 18 * n * n);
export function nivelDoXp(xp) {
  let n = 0;
  while (xp >= xpDoNivel(n + 1)) n += 1;
  return n;
}

const cache = new Map();
const sujos = new Set();
function dados(jid) {
  if (cache.has(jid)) return cache.get(jid);
  const d = lerJson(arquivoDo(jid), null) || { membros: {} };
  if (!d.membros || typeof d.membros !== "object") d.membros = {};
  cache.set(jid, d);
  return d;
}
export function membro(jid, id) {
  const d = dados(jid);
  const k = usuario(id);
  if (!d.membros[k]) d.membros[k] = { xp: 0, msgs: 0, rep: 0, ultimoXp: 0, ultimaRep: 0 };
  return d.membros[k];
}
function marcarSujo(jid) { sujos.add(jid); }
export function gravarNiveis() {
  for (const jid of sujos) {
    try { salvarJson(arquivoDo(jid), dados(jid), { compacto: true }); } catch {}
  }
  sujos.clear();
}
setInterval(gravarNiveis, 60_000).unref?.();

export function niveisLigados(jid) {
  const g = grupo(jid);
  return Boolean(g && g.niveis === true);
}
export function definirNiveis(jid, valor) {
  const g = grupo(jid);
  if (!g) return;
  g.niveis = Boolean(valor);
  salvarGrupo(jid);
}

export function registrarMensagem(jid, id) {
  if (!jid?.endsWith?.("@g.us") || !niveisLigados(jid)) return null;
  const m = membro(jid, id);
  m.msgs += 1;
  marcarSujo(jid);
  const agora = Date.now();
  if (agora - (m.ultimoXp || 0) < ESPERA_XP) return null;
  const antes = nivelDoXp(m.xp);
  m.xp += XP_MENSAGEM[0] + inteiro(0, XP_MENSAGEM[1] - XP_MENSAGEM[0]);
  m.ultimoXp = agora;
  const depois = nivelDoXp(m.xp);
  return depois > antes ? depois : null;
}

export async function somarXp(c, quanto) {
  if (!c?.jid?.endsWith?.("@g.us") || !niveisLigados(c.jid)) return;
  const m = membro(c.jid, c.autorJid);
  const antes = nivelDoXp(m.xp);
  m.xp += Math.max(0, Number(quanto) || 0);
  marcarSujo(c.jid);
  const depois = nivelDoXp(m.xp);
  if (depois > antes) await (await import("./rpg.js")).aoSubirNivel({ jid: c.jid, autorJid: c.autorJid, nivel: depois, falar: (t, mm) => c.responder(t, mm) }).catch(() => {});
}

const afks = new Map();
const chaveAfk = (jid, id) => `${jid}|${usuario(id)}`;
export const estaAfk = (jid, id) => afks.get(chaveAfk(jid, id)) || null;
export function tirarAfk(jid, id) {
  const k = chaveAfk(jid, id);
  const a = afks.get(k);
  if (a) afks.delete(k);
  return a;
}
const desde = (ms) => {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${min % 60 ? ` ${min % 60}min` : ""}` : `${Math.floor(h / 24)} dia(s)`;
};

const C = [];
const def = (nomes, opc, run) => C.push({ nomes, ...opc, run });
const G = { grupo: true };
const marca = (id) => `@${usuario(id)}`;
const barra = (p) => "█".repeat(Math.round(p * 10)) + "░".repeat(10 - Math.round(p * 10));

def(["perfil", "meuperfil", "meustatus"], G, async (c) => {
  const alvo = alvos(c.msg, c.meta, c.args)[0] || c.autorJid;
  const m = membro(c.jid, alvo);
  const nivel = nivelDoXp(m.xp);
  const p = patente(nivel);
  const base = xpDoNivel(nivel);
  const proximo = xpDoNivel(nivel + 1);
  const prog = Math.min(1, Math.max(0, (m.xp - base) / Math.max(1, proximo - base)));
  const texto = `${p.emoji} *PERFIL — ${p.nome}*\n\n` +
    `👤 ${marca(alvo)}\n` +
    `🏅 Nível: *${nivel}*\n` +
    `✨ XP: *${m.xp}* (${m.xp - base}/${proximo - base} para o nível ${nivel + 1})\n` +
    `${barra(prog)} ${Math.round(prog * 100)}%\n` +
    `💬 Mensagens: *${m.msgs}*\n` +
    `❤️ Reputação: *${m.rep}*` +
    await (async () => {
      try {
        const A = await import("./aparelhos.js");
        const pn = c.meta?.participants?.find((x) => [x?.id, x?.lid, x?.jid].some((y) => usuario(y) === usuario(alvo)));
        const proprio = usuario(alvo) === usuario(c.autorJid) ? A.aparelhoDoId(c.msg?.key?.id) : null;
        const NOME = { android: "Android", ios: "iPhone", web: "WhatsApp Web", desktop: "WhatsApp no computador" };
        const ap = (proprio && NOME[proprio]) || A.aparelhoDe(alvo, pn?.id, pn?.lid, pn?.phoneNumber, pn?.jid);
        return `\n📱 Aparelho: *${ap || "ainda não sei"}*`;
      } catch { return ""; }
    })();
  return c.responder((await import("./economia.js")).decorarPerfil(c.jid, alvo, texto), [alvo]);
});

function doGrupo(c, d, campo) {
  const temLista = (c.meta?.participants || []).length > 0;
  const porPessoa = new Map();
  for (const [num, m] of Object.entries(d.membros)) {
    if (!(m[campo] > 0)) continue;
    const p = participante(c.meta, [num]);
    if (temLista && !p) continue;
    const jid = p?.id || jidDoNumero(c.meta, num);
    const x = porPessoa.get(jid) || { jid, xp: 0, rep: 0 };
    x.xp += m.xp || 0; x.rep += m.rep || 0;
    porPessoa.set(jid, x);
  }
  return [...porPessoa.values()].sort((a, b) => b[campo] - a[campo]);
}

def(["rank", "ranknivel", "topnivel"], G, async (c) => {
  const d = dados(c.jid);
  if (c.cmd === "rank" && c.args.length) {
    const { COMANDOS } = await import("./comandos.js");
    const tema = c.args.join(" ").toLowerCase();
    const def = COMANDOS.get(`rank${tema.replace(/\s+/g, "")}`) || COMANDOS.get("ranking");
    if (def) return def.run({ ...c, cmd: def.nomes[0], args: def.nomes[0] === "ranking" ? c.args : [], texto: def.nomes[0] === "ranking" ? c.texto : "" });
  }
  const lista = doGrupo(c, d, "xp").slice(0, 10);
  if (!lista.length) return c.responder("Ainda não tem ninguém pontuado aqui. Conversem! 😄");
  const medalhas = ["🥇", "🥈", "🥉"];
  const linhas = lista.map((x, i) => `${medalhas[i] || `${i + 1}.`} @${usuario(x.jid)} — nível *${nivelDoXp(x.xp)}* (${x.xp} XP)`).join("\n");
  return c.responder(`🏆 *RANKING DO GRUPO*\n\n${linhas}`, lista.map((x) => x.jid));
});

def(["rep", "reputacao"], G, async (c) => {
  const alvo = alvos(c.msg, c.meta, c.args)[0];
  if (!alvo) return c.responder(`Marque quem você quer elogiar: *${c.prefixo}rep @fulano*`);
  if (usuario(alvo) === usuario(c.autorJid)) return c.responder("Dar reputação para si mesmo? Boa tentativa. 😏");
  const eu = membro(c.jid, c.autorJid);
  const falta = ESPERA_REP - (Date.now() - (eu.ultimaRep || 0));
  if (falta > 0) return c.responder(`⏳ Você já deu reputação há pouco. Pode dar de novo em ${Math.ceil(falta / 3600_000)}h.`);
  eu.ultimaRep = Date.now();
  const m = membro(c.jid, alvo);
  m.rep += 1;
  marcarSujo(c.jid);
  return c.responder(`❤️ ${marca(c.autorJid)} deu +1 de reputação para ${marca(alvo)}!\nAgora tem *${m.rep}*.`, [c.autorJid, alvo]);
});

def(["toprep"], G, async (c) => {
  const d = dados(c.jid);
  const lista = doGrupo(c, d, "rep").slice(0, 10);
  if (!lista.length) return c.responder("Ninguém tem reputação ainda. Use *!rep @fulano* para começar.");
  const linhas = lista.map((x, i) => `${i + 1}. @${usuario(x.jid)} — *${x.rep}* ❤️`).join("\n");
  return c.responder(`❤️ *TOP REPUTAÇÃO*\n\n${linhas}`, lista.map((x) => x.jid));
});

def(["afk"], G, async (c) => {
  const motivo = c.texto.trim().slice(0, 120) || "sem motivo";
  afks.set(chaveAfk(c.jid, c.autorJid), { motivo, desde: Date.now() });
  return c.responder(`😴 ${marca(c.autorJid)} ficou AFK.\n📝 Motivo: ${motivo}\n\n_Avisarei quem te marcar._`, [c.autorJid]);
});

def(["voltei"], G, async (c) => {
  const a = tirarAfk(c.jid, c.autorJid);
  if (!a) return c.responder("Você não estava AFK. 😄");
  return c.responder(`👋 Bem-vindo(a) de volta, ${marca(c.autorJid)}! Ficou fora ${desde(a.desde)}.`, [c.autorJid]);
});

def(["niveis"], { grupo: true, admin: true }, async (c) => {
  if (!["1", "0", "on", "off"].includes(String(c.args[0] || "").toLowerCase())) return c.responder(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
  const v = c.args[0] === "1" || /^on$/i.test(c.args[0]);
  definirNiveis(c.jid, v);
  return c.responder(t(v ? "ativado" : "desativado"));
});

export const COMANDOS_NIVEIS = C;
export const TOTAL_NIVEIS = C.length;
