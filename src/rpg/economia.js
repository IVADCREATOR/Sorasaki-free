import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CONFIG } from "./config.js";
import { lerJson, salvarJson } from "./arquivo.js";
import { usuario, alvos, participante, idsDoParticipante } from "./grupos.js";
import { grupo, salvarGrupo } from "./dados.js";

const PASTA = path.join(CONFIG.pastas.dados, "economia");
const arquivoDo = (jid) => path.join(PASTA, `${jid}.json`);
const ARQ_BOLSA = path.join(PASTA, "_bolsa.json");
const MIN = 60_000, HORA = 3600_000, DIA = 86400_000;
const GRATIS_TETO = 676, LIMITE_MAX = 1_000_000;
export const FONTES_GANHO = {
  diario: { nome: "🎁 Diário", base: [100, 676], nomes: ["diario", "diário", "daily"] },
  trabalhar: { nome: "💼 Trabalhar", base: [1, 676], nomes: ["trabalhar", "trabalho", "work", "trampo"] },
  crime: { nome: "🦹 Crime (quando dá certo)", base: [200, 676], nomes: ["crime", "assalto"] },
  coletas: { nome: "🎣 Coletas (pescar, minerar, caçar)", base: [340, 676], nomes: ["coletas", "coleta", "pescar", "minerar", "cacar", "caçar", "mochila"] },
  desafios: { nome: "🧠 Desafios", base: [60, 676], nomes: ["desafios", "desafio"] },
  jogos: { nome: "🎲 Jogos do grupo", base: [100, 540], nomes: ["jogos", "jogo", "forca", "quiz", "anagrama", "digitar"] },
  missoes: { nome: "📜 Missões e baú", base: [270, 676], nomes: ["missoes", "missões", "missao", "missão", "bau", "baú"] },
  meta: { nome: "🤝 Meta do grupo", base: [268, 676], nomes: ["meta", "metagrupo"] },
  conquistas: { nome: "🏅 Conquistas", base: [135, 676], nomes: ["conquistas", "conquista"] }
};
const ARQ_LIMITES = path.join(PASTA, "_limites.json");
let limitesCache = null;
function limites() {
  if (!limitesCache) { limitesCache = lerJson(ARQ_LIMITES, null) || {}; limitesCache.fontes ||= {}; limitesCache.hist ||= []; }
  return limitesCache;
}
function salvarLimites() { salvarJson(ARQ_LIMITES, limites()); }
const faixaOk = (f) => Array.isArray(f) && f.length === 2 && f.every((x) => Number.isFinite(x) && x >= 1) && f[0] <= f[1];
export function faixaGanho(fonte, m = null) {
  const da = m?.limites?.[fonte];
  if (faixaOk(da)) return da;
  const geral = limites().fontes[fonte];
  return faixaOk(geral) ? geral : FONTES_GANHO[fonte].base;
}
function ganho(fonte, v, m = null) {
  const [b0, b1] = FONTES_GANHO[fonte].base;
  const [n0, n1] = faixaGanho(fonte, m);
  const x = Math.min(b1, Math.max(b0, Number(v) || 0));
  if (n0 === b0 && n1 === b1) return Math.max(1, Math.floor(x));
  return Math.max(1, Math.round(n0 + (b1 === b0 ? 1 : (x - b0) / (b1 - b0)) * (n1 - n0)));
}
export const tetoGanho = (fonte) => faixaGanho(fonte)[1];
export const valorGanho = (fonte, v) => ganho(fonte, v);

export const PADRAO_RPG = {
  economia: false, apostas: true, bolsa: true, loja: true, investir: true, roubo: false, resgate: true,
  avisoNivel: "todos", rankingPublico: false, emprestimo: true,
  apostaMax: 50_000, transferenciaDia: 20_000, emprestimoMax: 50_000
};
export function cfgRpg(jid) {
  const g = grupo(jid);
  const atual = g && g.rpg && typeof g.rpg === "object" ? g.rpg : {};
  return { ...PADRAO_RPG, ...atual, apostaMax: Infinity, emprestimoMax: Infinity };
}
export function definirRpg(jid, chave, valor) {
  const g = grupo(jid);
  if (!g) return;
  g.rpg = { ...(g.rpg && typeof g.rpg === "object" ? g.rpg : {}), [chave]: valor };
  salvarGrupo(jid);
}

const ARQ_CONTAS = path.join(PASTA, "_contas.json");
const cache = new Map();
const sujos = new Set();
let CG = null;
let gSujo = false;
const ehGrupo = (jid) => String(jid || "").endsWith("@g.us");
function contasGlobais() {
  if (CG) return CG;
  CG = lerJson(ARQ_CONTAS, null);
  if (!CG || typeof CG !== "object" || !CG.membros) { CG = { membros: {}, alias: {}, jid: {}, emprestimos: [], criadoEm: Date.now() }; migrarGrupos(); }
  CG.alias ||= {}; CG.jid ||= {}; CG.emprestimos ||= [];
  return CG;
}
function resolver(k) {
  const g = contasGlobais();
  for (let i = 0; i < 6 && g.alias[k] && g.alias[k] !== k; i++) k = g.alias[k];
  return k;
}
function unir(de, para) {
  const g = contasGlobais();
  if (!de || !para || de === para) return false;
  let mudou = false;
  if (g.membros[de]) {
    if (!g.membros[para]) g.membros[para] = g.membros[de];
    else juntar(g.membros[para], g.membros[de]);
    delete g.membros[de];
    mudou = true;
  }
  for (const e of g.emprestimos) {
    if (e.credor === de) { e.credor = para; mudou = true; }
    if (e.devedor === de) { e.devedor = para; mudou = true; }
  }
  if (g.alias[para] === de) { delete g.alias[para]; mudou = true; }
  if (g.alias[de] !== para) { g.alias[de] = para; mudou = true; }
  return mudou;
}
function absorverGrupo(jid, raw) {
  const g = contasGlobais();
  const jids = raw.jids && typeof raw.jids === "object" ? raw.jids : {};
  const ehLid = (k) => String(jids[k] || "").endsWith("@lid");
  const local = {};
  for (const [outro, principal] of Object.entries(raw.alias || {})) {
    if (ehLid(principal) && !ehLid(outro)) { local[principal] = outro; local[outro] = outro; }
    else local[outro] = principal;
  }
  const canon = (k) => resolver(local[k] || k);
  for (const [outro] of Object.entries(raw.alias || {})) {
    const c = canon(outro);
    if (outro !== c) unir(outro, c);
  }
  for (const [principal] of Object.entries(jids)) { const c = canon(principal); if (principal !== c) unir(principal, c); }
  const presentes = new Set(raw.presentes || []);
  for (const [k, m] of Object.entries(raw.membros || {})) {
    const c = canon(k);
    if (!g.membros[c]) g.membros[c] = m; else juntar(g.membros[c], m);
    presentes.add(c);
  }
  for (const e of raw.emprestimos || []) {
    if (g.emprestimos.some((x) => x.id === e.id && x.jid === jid)) continue;
    g.emprestimos.push({ ...e, credor: canon(e.credor), devedor: canon(e.devedor), jid });
  }
  const novosJids = {};
  for (const [k, full] of Object.entries(jids)) {
    const c = canon(k);
    novosJids[c] = full;
    if (!String(full).endsWith("@lid")) g.jid[c] = full; else g.jid[c] ||= full;
  }
  const { membros, alias, emprestimos, jids: _j, ...resto } = raw;
  gSujo = true;
  return { ...resto, jids: novosJids, presentes: [...presentes] };
}
function migrarGrupos() {
  let arquivos = [];
  try { arquivos = fs.readdirSync(PASTA).filter((f) => /@g\.us\.json$/.test(f)); } catch {}
  for (const f of arquivos) {
    const arq = path.join(PASTA, f);
    const raw = lerJson(arq, null);
    if (!raw || typeof raw !== "object") continue;
    try { if (!fs.existsSync(`${arq}.antes-global`)) fs.copyFileSync(arq, `${arq}.antes-global`); } catch {}
    const limpo = absorverGrupo(f.slice(0, -5), raw);
    try { salvarJson(arq, limpo, { compacto: true }); } catch {}
  }
  CG.migradoEm = Date.now();
  try { salvarJson(ARQ_CONTAS, CG, { compacto: true }); } catch {}
}
function dados(jid) {
  if (cache.has(jid)) return cache.get(jid);
  const g = contasGlobais();
  let d = (ehGrupo(jid) && lerJson(arquivoDo(jid), null)) || {};
  if ((d.membros && Object.keys(d.membros).length) || d.alias || d.emprestimos?.length) { d = absorverGrupo(jid, d); sujos.add(jid); }
  d.jids ||= {}; d.presentes ||= [];
  for (const [campo, ler] of [["membros", () => g.membros], ["alias", () => g.alias], ["emprestimos", () => g.emprestimos]]) Object.defineProperty(d, campo, { get: ler, enumerable: false, configurable: true });
  cache.set(jid, d);
  return d;
}
export const SALDO_INICIAL = 500;
const LIMITE = 9e15;
const aliasesEm = new Map();
export const chave = (jid, id) => resolver(usuario(id));
export function jidDe(jid, k) { return dados(jid).jids?.[k] || contasGlobais().jid[k] || (String(k).length > 13 ? `${k}@lid` : `${k}@s.whatsapp.net`); }
const mk = (jid, k) => `@${usuario(jidDe(jid, k))}`;
export function presentesNoGrupo(jid, meta = null) {
  if (meta?.participants?.length) return new Set(meta.participants.map((p) => chave(jid, p.id)));
  return new Set(dados(jid).presentes || []);
}
function juntar(destino, origem) {
  for (const f of ["carteira", "banco", "comprado", "apostado", "ganhoApostas", "divRecebidos", "calotes", "coletas"]) destino[f] = (destino[f] || 0) + (origem[f] || 0);
  if (destino.inicial && origem.inicial) destino.carteira = Math.max(0, destino.carteira - SALDO_INICIAL);
  destino.inicial ||= origem.inicial;
  for (const [t, a] of Object.entries(origem.acoes || {})) {
    const x = (destino.acoes ||= {})[t] ||= { qtd: 0, custo: 0 };
    x.qtd += a?.qtd || 0; x.custo += a?.custo || 0; x.divEm = Math.min(x.divEm || Date.now(), a?.divEm || Date.now());
  }
  for (const [k, q] of Object.entries(origem.itens || {})) (destino.itens ||= {})[k] = Math.max(destino.itens?.[k] || 0, Math.min(maxDe(k), (destino.itens?.[k] || 0) + q));
  for (const [k, q] of Object.entries(origem.mochila || {})) (destino.mochila ||= {})[k] = (destino.mochila[k] || 0) + q;
  for (const [k, q] of Object.entries(origem.achados || {})) (destino.achados ||= {})[k] = (destino.achados[k] || 0) + q;
  for (const [k, v] of Object.entries(origem.esperas || {})) (destino.esperas ||= {})[k] = Math.max(destino.esperas[k] || 0, v || 0);
  for (const [k, h] of Object.entries(origem.hospital || {})) if (!destino.hospital?.[k] || h?.ate > destino.hospital[k].ate) (destino.hospital ||= {})[k] = h;
  if (origem.poupanca?.valor) { destino.poupanca ||= { valor: 0, em: Date.now(), juros: 0 }; destino.poupanca.valor += origem.poupanca.valor; }
  destino.cdbs = [...(destino.cdbs || []), ...(origem.cdbs || [])].slice(0, MAX_CDB + 5);
  destino.hist = [...(destino.hist || []), ...(origem.hist || [])].sort((a, b) => a.t - b.t).slice(-MAX_HIST);
  destino.conquistas = { ...(origem.conquistas || {}), ...(destino.conquistas || {}) };
  if (origem.cosm) {
    const k = cosmeticos(destino);
    k.molduras = [...new Set([...k.molduras, ...(origem.cosm.molduras || [])])];
    k.titulos = [...new Set([...k.titulos, ...(origem.cosm.titulos || [])])];
    if (!k.livre && origem.cosm.livre) k.livre = origem.cosm.livre;
  }
  for (const f of ["termos", "congelado"]) if (origem[f] && !destino[f]) destino[f] = origem[f];
  for (const f of ["pausaApostasAte", "ultimoRoubo", "ultimoCrime", "ultimoDiario", "ultimoTrabalho", "roubadoEm", "ultimaColeta"]) if (origem[f]) destino[f] = Math.max(destino[f] || 0, origem[f]);
  destino.sequencia = Math.max(destino.sequencia || 0, origem.sequencia || 0);
  if (origem.transfDia && origem.transfDia === destino.transfDia) destino.transfTotal = (destino.transfTotal || 0) + (origem.transfTotal || 0);
  else if (origem.transfDia && (!destino.transfDia || origem.transfDia > destino.transfDia)) { destino.transfDia = origem.transfDia; destino.transfTotal = origem.transfTotal || 0; }
  destino.termosHist = [...(destino.termosHist || []), ...(origem.termosHist || [])].slice(-10);
  destino.criadoEm = Math.min(destino.criadoEm || Date.now(), origem.criadoEm || Date.now());
}
export function aprenderIds(jid, meta, { forcar = false } = {}) {
  if (!meta?.participants?.length) return;
  if (!forcar && Date.now() - (aliasesEm.get(jid) || 0) < 5 * MIN) return;
  aliasesEm.set(jid, Date.now());
  const d = dados(jid), g = contasGlobais();
  let mudou = false;
  const presentes = new Set();
  for (const p of meta.participants) {
    const ids = idsDoParticipante(p);
    if (!ids.length) continue;
    const pn = [p.phoneNumber, p.jid, p.id].find((x) => String(x || "").endsWith("@s.whatsapp.net"));
    const principal = pn ? usuario(pn) : ids.map(resolver).find((x) => g.membros[x]) || resolver(usuario(p.id));
    for (const outro of new Set([...ids, ...ids.map(resolver)])) if (outro !== principal && unir(outro, principal)) mudou = true;
    if (g.alias[principal]) { delete g.alias[principal]; mudou = true; }
    if (d.jids[principal] !== p.id) { d.jids[principal] = p.id; mudou = true; }
    const global = pn || (String(p.id).endsWith("@lid") ? p.id : null);
    if (global && (pn || !g.jid[principal]) && g.jid[principal] !== global) { g.jid[principal] = global; mudou = true; }
    presentes.add(principal);
  }
  const lista = [...presentes].sort();
  if (lista.join() !== [...(d.presentes || [])].sort().join()) { d.presentes = lista; mudou = true; }
  if (mudou) marcar(jid);
}
function darInicial(jid, m) {
  if (m.inicial) return;
  m.inicial = Date.now();
  m.carteira = (Number(m.carteira) || 0) + SALDO_INICIAL;
  anotar(m, "boas-vindas", SALDO_INICIAL, "sistema");
  marcar(jid);
}

export function conta(jid, id) {
  const d = dados(jid);
  const k = chave(jid, id);
  if (!d.membros[k]) d.membros[k] = { carteira: 0, banco: 0, acoes: {}, itens: {}, comprado: 0, criadoEm: Date.now() };
  const m = d.membros[k];
  m.acoes ||= {}; m.itens ||= {}; m.hist ||= [];
  acrescentarRendimentos(m, jid);
  if (tx && !tx.contas.has(m)) tx.contas.set(m, { k, total: saldoLiquido(m) });
  return m;
}

const MAX_HIST = 40;
let tx = null;
export function anotar(m, tipo, delta, por = null) {
  if (!delta) return;
  m.hist ||= [];
  m.hist.push({ t: Date.now(), tipo: String(tipo).slice(0, 24), v: Math.round(delta), s: Math.floor(m.carteira || 0), ...(por ? { por: String(por).slice(0, 20) } : {}) });
  if (m.hist.length > MAX_HIST) m.hist.splice(0, m.hist.length - MAX_HIST);
}
const saldoLiquido = (m) => Math.floor((m.carteira || 0) + (m.banco || 0) + (m.poupanca?.valor || 0) + (m.cdbs || []).reduce((s, x) => s + x.valor, 0));
function sanear(m) {
  for (const k of ["carteira", "banco"]) {
    const v = Math.floor(Number(m[k]) || 0);
    m[k] = Math.min(LIMITE, Math.max(0, v));
  }
  if (m.poupanca) m.poupanca.valor = Math.min(LIMITE, Math.max(0, Math.floor(Number(m.poupanca.valor) || 0)));
}
async function emTransacao(jid, tipo, por, fn) {
  if (tx) return fn();
  tx = { jid, contas: new Map() };
  const atual = tx;
  try {
    return await fn();
  } finally {
    tx = null;
    for (const [m, antes] of atual.contas) {
      sanear(m);
      const depois = saldoLiquido(m);
      if (depois !== antes.total) { anotar(m, tipo, depois - antes.total, antes.k === por ? null : por); marcar(jid); }
    }
  }
}
export const marcar = (jid) => { sujos.add(jid); gSujo = true; };
export function esquecerFantasma(jid, id) {
  const g = contasGlobais(), k = chave(jid, id), m = g.membros[k];
  if (m && !m.carteira && !m.banco && !Object.keys(m.acoes || {}).length) { delete g.membros[k]; gSujo = true; }
  cache.delete(jid); sujos.delete(jid);
  try { fs.unlinkSync(arquivoDo(jid)); } catch {}
}
export function gravarEconomia() {
  for (const jid of sujos) {
    if (!ehGrupo(jid)) continue;
    try { salvarJson(arquivoDo(jid), dados(jid), { compacto: true }); } catch {}
  }
  sujos.clear();
  if (gSujo && CG) { try { salvarJson(ARQ_CONTAS, CG, { compacto: true }); gSujo = false; } catch {} }
  if (bolsa?.sujo) { try { salvarJson(ARQ_BOLSA, { ...bolsa, sujo: undefined }, { compacto: true }); bolsa.sujo = false; } catch {} }
}
setInterval(gravarEconomia, 20_000).unref?.();
process.on("exit", gravarEconomia);
export function lembrarNomeDoGrupo(jid, nome) {
  if (!nome || !ehGrupo(jid)) return;
  const d = dados(jid);
  if (d.nome !== nome) { d.nome = String(nome).slice(0, 120); marcar(jid); }
}
export function gruposComEconomia() {
  let noDisco = [];
  try { noDisco = fs.readdirSync(PASTA).filter((f) => /@g\.us\.json$/.test(f)).map((f) => f.slice(0, -5)); } catch {}
  return [...new Set([...noDisco, ...[...cache.keys()].filter(ehGrupo)])];
}

const POUPANCA_DIA = 0.002;
const POUPANCA_TETO = 5_000_000;
function acrescentarRendimentos(m, jid) {
  const agora = Date.now();
  let mudou = false;
  if (m.poupanca?.valor > 0) {
    const dias = (agora - (m.poupanca.em || agora)) / DIA;
    const juros = Math.floor(Math.min(m.poupanca.valor, POUPANCA_TETO) * POUPANCA_DIA * dias);
    if (juros > 0) { m.poupanca.valor += juros; m.poupanca.em = agora; m.poupanca.juros = (m.poupanca.juros || 0) + juros; anotar(m, "juros poupança", juros, "sistema"); mudou = true; }
  }
  for (const [t, a] of Object.entries(m.acoes || {})) {
    const taxa = ATIVOS[t]?.div || 0;
    if (!taxa || !(a?.qtd > 0)) continue;
    if (!a.divEm) { a.divEm = agora; mudou = true; continue; }
    const dias = Math.min(30, (agora - a.divEm) / DIA);
    const v = Math.floor(a.qtd * precoAcao(t) * taxa * dias);
    if (v > 0) { m.carteira += v; a.divEm = agora; m.divRecebidos = (m.divRecebidos || 0) + v; anotar(m, `dividendos ${t}`, v, "sistema"); mudou = true; }
  }
  if (mudou && jid) marcar(jid);
}
const PRAZOS_CDB = { 7: 0.02, 15: 0.05, 30: 0.12 };
const MULTA_CDB = 0.02;
const MAX_CDB = 5;

const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString("pt-BR");
export const moedas = (n) => `🪙 ${fmt(n)}`;
const aleatorio = () => crypto.randomInt(0, 2 ** 48 - 1) / (2 ** 48 - 1);
const sorteio = (a, b) => crypto.randomInt(a, b + 1);
const chance = (p) => aleatorio() < p;
const marca = (id) => `@${usuario(id)}`;
const espera = (ms) => {
  const m = Math.ceil(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}min` : ""}`;
};
export function lerValor(txt, disponivel) {
  const t = String(txt || "").toLowerCase().trim();
  if (["tudo", "all", "max", "máx", "maximo", "máximo"].includes(t)) return Math.floor(disponivel);
  if (["metade", "meio", "half"].includes(t)) return Math.floor(disponivel / 2);
  const m = /^(\d+(?:[.,]\d+)?)(k{0,4}|mil|mi|m|bi|b|tri|t)?$/.exec(t.replace(/\.(?=\d{3}(\D|$))/g, ""));
  if (!m) return NaN;
  const base = Number(m[1].replace(",", "."));
  const mult = { "": 1, k: 1e3, kk: 1e6, kkk: 1e9, kkkk: 1e12, mil: 1e3, mi: 1e6, m: 1e6, b: 1e9, bi: 1e9, t: 1e12, tri: 1e12 }[m[2] || ""];
  return Math.floor(base * mult);
}

const ATIVOS = {
  SORA3: { risco: "médio", nome: "Sorasaki Tech", base: 120, vol: 0.05, emoji: "💠" },
  HINA4: { risco: "médio", nome: "Hina Entretenimento", base: 80, vol: 0.045, emoji: "🌸" },
  IVAD7: { risco: "baixo", div: 0.0006, nome: "IVAD Holding", base: 300, vol: 0.025, emoji: "👑" },
  NEKO11: { risco: "baixo", div: 0.0015, nome: "Neko Imóveis (fundo)", base: 50, vol: 0.018, emoji: "🐱" },
  LUNA3: { risco: "médio", div: 0.0005, nome: "Luna Energia", base: 65, vol: 0.04, emoji: "🌙" },
  MOCHI3: { risco: "médio", div: 0.0008, nome: "Mochi Alimentos", base: 30, vol: 0.035, emoji: "🍡" },
  CRYP7: { risco: "alto", nome: "CryptoSora", base: 10, vol: 0.14, emoji: "🪐" }
};
const PASSO_BOLSA = 10 * MIN;
const HIST_BOLSA = 144;
const TAXA_BOLSA = 0.01;
const NOTICIAS_ALTA = ["anuncia parceria gigante", "bate recorde de lucro", "lança produto que viraliza", "recebe investimento estrangeiro"];
const NOTICIAS_BAIXA = ["sofre com escândalo", "tem prejuízo no trimestre", "perde contrato importante", "é investigada por bagunça contábil"];
let bolsa = null;
function normal() { let u = 0, v = 0; while (!u) u = aleatorio(); while (!v) v = aleatorio(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function carregarBolsa() {
  if (bolsa) return bolsa;
  const b = lerJson(ARQ_BOLSA, null) || {};
  bolsa = { atualizadoEm: Number(b.atualizadoEm) || Date.now(), precos: {}, historico: {}, noticias: Array.isArray(b.noticias) ? b.noticias.slice(-5) : [] };
  for (const [t, a] of Object.entries(ATIVOS)) {
    bolsa.precos[t] = Number(b.precos?.[t]) > 0 ? Number(b.precos[t]) : a.base;
    bolsa.historico[t] = Array.isArray(b.historico?.[t]) ? b.historico[t].slice(-HIST_BOLSA) : [bolsa.precos[t]];
  }
  return bolsa;
}
function passoBolsa() {
  const b = carregarBolsa();
  let passos = Math.min(144, Math.floor((Date.now() - b.atualizadoEm) / PASSO_BOLSA));
  if (passos <= 0) return b;
  while (passos-- > 0) {
    for (const [t, a] of Object.entries(ATIVOS)) {
      const p = b.precos[t];
      const volta = 0.02 * Math.log(a.base / p);
      let novo = p * Math.exp(volta + a.vol * normal());
      if (chance(0.01)) {
        const alta = chance(0.5);
        const pct = sorteio(10, 35) / 100;
        novo *= alta ? 1 + pct : 1 - pct;
        b.noticias.push({ t, em: Date.now(), texto: `${a.emoji} ${t} ${aleatorioDe(alta ? NOTICIAS_ALTA : NOTICIAS_BAIXA)} (${alta ? "+" : "−"}${Math.round(pct * 100)}%)` });
        b.noticias = b.noticias.slice(-5);
      }
      b.precos[t] = Math.max(1, Math.round(novo * 100) / 100);
      b.historico[t] = [...b.historico[t], b.precos[t]].slice(-HIST_BOLSA);
    }
    b.atualizadoEm += PASSO_BOLSA;
  }
  b.sujo = true;
  return b;
}
const aleatorioDe = (l) => l[Math.floor(aleatorio() * l.length)];
export const precoAcao = (t) => passoBolsa().precos[t] || 0;
const BARRAS = "▁▂▃▄▅▆▇█";
function grafico(hist) {
  const pts = (Array.isArray(hist) ? hist : []).map(Number).filter(Number.isFinite).slice(-16);
  if (pts.length < 2) return "`▄▄▄▄` _(pouco histórico ainda)_";
  const min = Math.min(...pts), max = Math.max(...pts);
  const barras = pts.map((v) => BARRAS[max - min < 1e-9 ? 3 : Math.max(0, Math.min(7, Math.round(((v - min) / (max - min)) * 7)))]).join("");
  const ini = pts[0], fim = pts[pts.length - 1];
  const tend = fim > ini * 1.002 ? "📈" : fim < ini * 0.998 ? "📉" : "➖";
  return `\`${barras}\` ${tend}`;
}

const ITENS = {
  barraca: { nome: "Barraca de pastel", emoji: "🥟", preco: 2_000, renda: 10, cat: "comercio" },
  lojinha: { nome: "Lojinha", emoji: "🏪", preco: 12_000, renda: 66, cat: "comercio" },
  fazenda: { nome: "Fazenda", emoji: "🚜", preco: 45_000, renda: 260, cat: "agro" },
  mineradora: { nome: "Mineradora", emoji: "⛏️", preco: 150_000, renda: 940, cat: "industria" },
  predio: { nome: "Prédio comercial", emoji: "🏢", preco: 500_000, renda: 3_300, cat: "comercio" },
  terreno: { nome: "Terreno", emoji: "🗺️", preco: 300_000, renda: 1_900, cat: "comercio" },
  gado: { nome: "Rebanho de gado", emoji: "🐄", preco: 380_000, renda: 2_400, cat: "agro" },
  plantacao: { nome: "Plantação de soja", emoji: "🌱", preco: 450_000, renda: 2_900, cat: "agro" },
  haras: { nome: "Haras de cavalos", emoji: "🐎", preco: 650_000, renda: 4_300, cat: "agro" },
  fazendao: { nome: "Fazenda de gado", emoji: "🐂", preco: 900_000, renda: 6_100, cat: "agro" },
  usina: { nome: "Usina de cana", emoji: "🏭", preco: 1_500_000, renda: 10_000, cat: "industria" },
  academia: { nome: "Academia", emoji: "🏋️", preco: 1_500_000, renda: 11_000, cat: "comercio", max: 2 },
  restaurante: { nome: "Restaurante", emoji: "🍽️", preco: 2_250_000, renda: 16_000, cat: "comercio", max: 2 },
  posto: { nome: "Posto de gasolina", emoji: "⛽", preco: 3_000_000, renda: 22_000, cat: "industria", max: 2 },
  concessionaria: { nome: "Concessionária", emoji: "🚗", preco: 3_750_000, renda: 27_000, cat: "comercio", max: 2 },
  construtora: { nome: "Construtora", emoji: "🏗️", preco: 5_250_000, renda: 38_000, cat: "industria", max: 2 },
  cassino: { nome: "Cassino", emoji: "🎰", preco: 7_500_000, renda: 55_000, cat: "comercio", max: 2 },
  hotel: { nome: "Hotel 5 estrelas", emoji: "🏨", preco: 6_000_000, renda: 46_000, cat: "comercio", max: 2 },
  shopping: { nome: "Shopping center", emoji: "🛍️", preco: 10_000_000, renda: 79_000, cat: "comercio", max: 2 },
  frigorifico: { nome: "Frigorífico", emoji: "🥩", preco: 15_000_000, renda: 120_000, cat: "agro", max: 2 },
  petroleo: { nome: "Poço de petróleo", emoji: "🛢️", preco: 20_000_000, renda: 160_000, cat: "industria", max: 2 },
  porto: { nome: "Porto de cargas", emoji: "🚢", preco: 30_000_000, renda: 250_000, cat: "comercio", max: 2 },
  hidreletrica: { nome: "Usina hidrelétrica", emoji: "⚡", preco: 50_000_000, renda: 440_000, cat: "industria", max: 2 }
};

const ARQ_AJUSTES = path.join(PASTA, "_ajustes.json");
const ORIGINAIS = JSON.parse(JSON.stringify(ITENS));
const PREMIUM_PADRAO = {
  quiosque: { nome: "Quiosque Premium", emoji: "⭐", reais: 30, renda: 60_000 },
  supermercado: { nome: "Supermercado Premium", emoji: "🛒", reais: 50, renda: 110_000 },
  mansao: { nome: "Mansão Premium", emoji: "🏰", reais: 80, renda: 180_000 },
  jatinho: { nome: "Jatinho Premium", emoji: "🛩️", reais: 120, renda: 280_000 },
  ilha: { nome: "Ilha Particular", emoji: "🏝️", reais: 180, renda: 420_000 },
  bancosora: { nome: "Banco Sora", emoji: "🏦", reais: 250, renda: 600_000 }
};
const CFG_PADRAO = {
  rouboMin: 5,
  tetoDivida: 10,
  juroHoras: 1,
  jurosMax: 30,
  vendaPct: 60,
  acumulaHoras: 24,
  maxComum: 1,
  cotacao: 75_000,
  premium: true,
  bonusMin: 80, bonusMax: 120
};
let AJ = lerJson(ARQ_AJUSTES, null) || {};
AJ.itens ||= {}; AJ.premium ||= {}; AJ.premiumApagadas ||= []; AJ.cfg ||= {};
const salvarAjustes = () => salvarJson(ARQ_AJUSTES, AJ);
export const CFG_JOGO = () => ({ ...CFG_PADRAO, ...AJ.cfg });
function aplicarAjustes() {
  for (const k of Object.keys(ITENS)) if (ITENS[k].premium) delete ITENS[k];
  for (const [k, o] of Object.entries(ORIGINAIS)) ITENS[k] = { ...o, ...(AJ.itens[k] || {}) };
  const prem = { ...PREMIUM_PADRAO, ...AJ.premium };
  for (const [k, x] of Object.entries(prem)) {
    if (AJ.premiumApagadas.includes(k) || ORIGINAIS[k]) continue;
    const o = { ...x, ...(AJ.itens[k] || {}) };
    ITENS[k] = { nome: o.nome, emoji: o.emoji || "⭐", reais: Number(o.reais), renda: Number(o.renda), preco: Math.round(Number(o.reais) * CFG_JOGO().cotacao), cat: null, premium: true, fixo: true, max: o.max || 1, off: o.off };
  }
}
aplicarAjustes();
const MAX_POR_ITEM_ = () => CFG_JOGO().maxComum;
const maxDe = (k) => ITENS[k]?.max || MAX_POR_ITEM_();
const ACUMULA = () => CFG_JOGO().acumulaHoras * HORA;
const VENDA = () => CFG_JOGO().vendaPct / 100;

const ARQ_MERCADO = path.join(PASTA, "_mercado.json");
let _mercado = null;
function mercado() {
  if (!_mercado) _mercado = lerJson(ARQ_MERCADO, {});
  return _mercado;
}
function salvarMercado() { salvarJson(ARQ_MERCADO, _mercado); }

const EVENTOS_POSSIVEIS = [
  { id: "boom_agro",      cat: "agro",      fator: 1.6,  emoji: "🌾", nome: "Boom do agronegócio" },
  { id: "crise_agro",     cat: "agro",      fator: 0.4,  emoji: "🌧️", nome: "Crise no campo" },
  { id: "boom_comercio",  cat: "comercio",  fator: 1.5,  emoji: "🛒", nome: "Alta no comércio" },
  { id: "crise_comercio", cat: "comercio",  fator: 0.5,  emoji: "📉", nome: "Queda no comércio" },
  { id: "boom_industria", cat: "industria", fator: 1.7,  emoji: "🏭", nome: "Expansão industrial" },
  { id: "crise_industria",cat: "industria", fator: 0.35, emoji: "⚠️", nome: "Crise industrial" },
  { id: "normal",         cat: null,        fator: 1.0,  emoji: "📊", nome: "Mercado estável" },
];

function atualizarMercado() {
  const m = mercado();
  const hoje = new Date().toISOString().slice(0, 10);
  if (m.dia === hoje) return m;

  const fatores = {};
  for (const k of Object.keys(ITENS)) fatores[k] = ITENS[k].fixo ? 1 : 0.5 + Math.random();

  let evento = EVENTOS_POSSIVEIS[EVENTOS_POSSIVEIS.length - 1];
  if (Math.random() < 0.30) {
    const opcoes = EVENTOS_POSSIVEIS.filter((e) => e.cat !== null);
    evento = opcoes[Math.floor(Math.random() * opcoes.length)];
    for (const [k, it] of Object.entries(ITENS)) {
      if (it.cat === evento.cat) fatores[k] = Math.min(2.5, fatores[k] * evento.fator);
    }
  }

  _mercado = { dia: hoje, fatores, evento: { id: evento.id, cat: evento.cat, fator: evento.fator, emoji: evento.emoji, nome: evento.nome } };
  salvarMercado();
  return _mercado;
}

function rendaComFator(k) {
  const it = ITENS[k];
  if (!it) return 0;
  if (it.fixo) return it.renda;
  const m = atualizarMercado();
  return it.renda * (m.fatores?.[k] ?? 1);
}

function rendaPendente(m) {
  const desde = m.ultimaColeta || Date.now();
  const horas = Math.min(ACUMULA(), Date.now() - desde) / HORA;
  let porHora = 0, fixo = 0;
  for (const [k, q] of Object.entries(m.itens || {})) { const v = rendaComFator(k) * q; if (ITENS[k]?.fixo) fixo += v; else porHora += v; }
  const cfg = CFG_JOGO();
  const bonus = (cfg.bonusMin + Math.random() * (cfg.bonusMax - cfg.bonusMin)) / 100;
  const total = porHora * horas * bonus + fixo * horas * Math.max(1, bonus);
  return { valor: Math.floor(total), porHora: Math.floor(porHora + fixo), bonusPct: Math.round((bonus - 1) * 100) };
}

export function patrimonio(m) {
  let acoes = 0;
  for (const [t, a] of Object.entries(m.acoes || {})) acoes += (a?.qtd || 0) * precoAcao(t);
  let itens = 0;
  for (const [k, q] of Object.entries(m.itens || {})) itens += (ITENS[k]?.preco || 0) * q;
  return Math.floor((m.carteira || 0) + (m.banco || 0) + (m.poupanca?.valor || 0) + (m.cdbs || []).reduce((s, x) => s + x.valor, 0) + acoes + itens);
}
function contasDoGrupo(jid, meta = null) {
  const g = contasGlobais();
  return [...presentesNoGrupo(jid, meta)].filter((k) => g.membros[k]).map((k) => [k, g.membros[k]]);
}
export function resumoDoGrupo(jid) {
  const d = dados(jid);
  let total = 0, membros = 0, topo = 0, comprado = 0;
  for (const [, m] of contasDoGrupo(jid)) {
    const p = patrimonio(m);
    if (p <= 0) continue;
    total += p; membros += 1; topo = Math.max(topo, p); comprado += m.comprado || 0;
  }
  return { jid, name: d.nome || null, total, members: membros, top: topo, bought: comprado };
}

export function creditar(jid, id, valor, { comprado = false, tipo = null } = {}) {
  const m = conta(jid, id);
  const v = Math.max(0, Math.floor(Number(valor) || 0));
  m.carteira = Math.min(LIMITE, m.carteira + v);
  if (!tx) anotar(m, tipo || (comprado ? "resgate" : "prêmio"), v, "sistema");
  if (comprado) m.comprado = (m.comprado || 0) + v;
  marcar(jid);
  if (comprado) gravarEconomia();
  return m;
}

const C = [];
const def = (nomes, opc, run) => C.push({ nomes, ...opc, rpg: true,
  run: (c) => { aprenderIds(c.jid, c.meta); cobrarAtrasados(); return emTransacao(c.jid, nomes[0], chave(c.jid, c.autorJid), () => run(c)); } });
const G = { grupo: true };

function exigir(c, parte = null) {
  const cfg = cfgRpg(c.jid);
  lembrarNomeDoGrupo(c.jid, c.meta?.subject);
  if (!cfg.economia) { c.responder(`🎮 RPG desligado. Use ${c.prefixo}modorpg 1`); return null; }
  const eu = conta(c.jid, c.autorJid);
  darInicial(c.jid, eu);
  if (eu.congelado) { c.responder(`🧊 Sua conta do RPG está congelada pelo dono${eu.congelado.motivo ? `: ${eu.congelado.motivo}` : ""}.`); return null; }
  const nomes = { investir: "Os investimentos estão desligados", apostas: "As apostas estão desligadas", bolsa: "A bolsa está desligada", loja: "A loja de propriedades está desligada", roubo: "O roubo está desligado", emprestimo: "Os empréstimos estão desligados", resgate: "O resgate de moedas do site está desligado" };
  if (parte && !cfg[parte]) { c.responder(`🚫 ${nomes[parte]}. Use ${c.prefixo}rpgconfig ${parte} 1`); return null; }
  return cfg;
}
const alvoMarcado = (c) => alvos(c.msg, c.meta, c.args.filter((a) => a.startsWith("@")))[0] || null;
const mesmaPessoa = (c, a, b) => chave(c.jid, a) === chave(c.jid, b);
const noGrupo = (c, id) => Boolean(participante(c.meta, [usuario(id), chave(c.jid, id)]));
const ehOBot = (c, id) => [c.sock?.user?.id, c.sock?.user?.lid].map(usuario).filter(Boolean).some((x) => chave(c.jid, x) === chave(c.jid, id));
const valoresDe = (c) => c.args.filter((a) => !a.startsWith("@"));
const DIA_MS = 86400000;
export function ehVipConta(m) { return Boolean(m?.vip?.ate && m.vip.ate > Date.now()); }
export const ehVip = (jid, id) => { try { return ehVipConta(conta(jid, id)); } catch { return false; } };
export function ehVipSemCriar(jid, ...ids) {
  try { const d = dados(jid); return ids.filter(Boolean).some((id) => ehVipConta(d.membros[chave(jid, id)])); } catch { return false; }
}
const PROTECAO_VIP = [
  "💎 {V} é *VIP*. Carteira de VIP tem segurança particular, e você não tem credencial pra chegar perto. 🛡️",
  "👑 Roubar um *VIP*? {V} está num patamar que você ainda não alcançou. Tenta de novo quando for do mesmo nível. 🛡️",
  "🛡️ Escudo VIP ativo. Nem a sombra de {V} você consegue tocar. Se comporta.",
];
function protegidoVip(c, alvo) {
  if (c.ehDono || !ehVip(c.jid, alvo) || ehVip(c.jid, c.autorJid)) return false;
  c.responder(`${PROTECAO_VIP[Math.floor(Math.random() * PROTECAO_VIP.length)].replace("{V}", marca(alvo))}\n_Só VIP rouba VIP. Quer entrar no clube? *${c.prefixo}vip*_`, [alvo]);
  return true;
}
export function darVip(jid, id, dias, origem = "pix") {
  const m = conta(jid, id);
  const base = ehVipConta(m) ? m.vip.ate : Date.now();
  m.vip = { ate: base + dias * DIA_MS, desde: m.vip?.desde || Date.now(), origem, aviso: null };
  marcar(jid);
  return m.vip.ate;
}
export function tirarVip(jid, id) { const m = conta(jid, id); const tinha = ehVipConta(m); delete m.vip; marcar(jid); return tinha; }
const selo = (jid, k) => { const m = contasGlobais().membros[resolver(k)]; return (dividaAtrasada(jid, k) ? " 📛" : "") + (ehVipConta(m) ? " 💎" : ""); };
function linhaDivida(jid, id) {
  const e = dividaDe(jid, id);
  if (!e) return "";
  return e.atrasado ? `\n📛 *CALOTEIRO(A)* — deve ${moedas(restante(e))} para ${mk(jid, e.credor)}` : `\n🧾 Dívida: ${moedas(restante(e))} para ${mk(jid, e.credor)} (vence em ${espera(e.venceEm - Date.now())})`;
}

def(["carteira", "saldo", "bal", "meusaldo"], {}, async (c) => {
  if (!exigir(c)) return;
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const { valor: renda } = rendaPendente(m);
  let acoes = 0;
  for (const [t, a] of Object.entries(m.acoes)) acoes += (a?.qtd || 0) * precoAcao(t);
  const itens = Object.entries(m.itens).filter(([, q]) => q > 0).map(([k, q]) => `${ITENS[k]?.emoji || "•"}×${q}`).join(" ");
  const pausa = m.pausaApostasAte > Date.now() ? `\n⏸️ Apostas pausadas até ${new Date(m.pausaApostasAte).toLocaleDateString("pt-BR")}` : "";
  return c.responder(`👛 *CARTEIRA* — ${marca(alvo)}\n\n` +
    `💵 Na mão: *${moedas(m.carteira)}*\n🏦 No banco: *${moedas(m.banco)}*\n📈 Em ações: *${moedas(acoes)}*\n` +
    `🏠 Propriedades: ${itens || "nenhuma"}${renda ? ` _(+${fmt(renda)} para coletar)_` : ""}\n` +
    `🐷 Poupança: *${moedas(m.poupanca?.valor || 0)}* · 🏛️ CDB: *${moedas((m.cdbs || []).reduce((s, x) => s + x.valor, 0))}*\n\n` +
    `💎 Patrimônio: *${moedas(patrimonio(m))}*${m.comprado ? `\n🛒 Compradas: ${moedas(m.comprado)}` : ""}${pausa}${linhaDivida(c.jid, alvo)}\n\n` +
    `${ehVipConta(m) ? `\n💎 *VIP* até ${new Date(m.vip.ate).toLocaleDateString("pt-BR")}` : ""}\n🌐 _Suas moedas valem em todos os grupos da Hina._\n_O que está na mão pode ser roubado; o banco é seguro._`, [alvo]);
});

def(["diario", "daily", "recompensa"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const agora = Date.now();
  const falta = DIA - (agora - (m.ultimoDiario || 0));
  if (falta > 0) return c.responder(`⏳ Você já pegou o diário. Volte em *${espera(falta)}*.`);
  m.sequencia = agora - (m.ultimoDiario || 0) < 2 * DIA ? Math.min(7, (m.sequencia || 0) + 1) : 1;
  const valor = ganho("diario", 100 + (m.sequencia - 1) * 80 + sorteio(0, 96), m);
  m.ultimoDiario = agora;
  m.carteira += valor;
  marcar(c.jid);
  progresso(c, "diario");
  return c.responder(`🎁 ${marca(c.autorJid)} pegou o diário: *+${moedas(valor)}*\n🔥 Sequência: ${"🟣".repeat(m.sequencia)}${"⚪".repeat(7 - m.sequencia)} (${m.sequencia}/7)\n_Volte amanhã para aumentar o bônus._`, [c.autorJid]);
});

const TRABALHOS = [
  ["entregou marmitas de bike", "🚲"], ["programou um site para a padaria", "💻"], ["cortou o cabelo do bairro inteiro", "💈"],
  ["fez live tocando violão", "🎸"], ["vendeu brigadeiro na saída da escola", "🍫"], ["consertou o celular do vizinho", "📱"],
  ["passeou com os cachorros da rua", "🐕"], ["deu aula particular de matemática", "📚"], ["trabalhou de garçom num casamento", "🍽️"],
  ["editou vídeo para um youtuber", "🎬"], ["lavou carros no posto", "🚗"], ["montou móveis de uma loja", "🪛"]
];
def(["trabalhar", "work", "trampo", "trampar"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const falta = 20 * MIN - (Date.now() - (m.ultimoTrabalho || 0));
  if (falta > 0) return c.responder(`😮‍💨 Você está cansado(a). Pode trabalhar de novo em *${espera(falta)}*.`);
  const [o, e] = aleatorioDe(TRABALHOS);
  const valor = ganho("trabalhar", sorteio(1, 676), m);
  m.ultimoTrabalho = Date.now();
  m.carteira += valor;
  marcar(c.jid);
  progresso(c, "trabalhar");
  return c.responder(`${e} ${marca(c.autorJid)} ${o} e ganhou *${moedas(valor)}*!`, [c.autorJid]);
});

const CRIMES_OK = ["hackeou o caixa eletrônico do jogo", "contrabandeou figurinhas raras", "aplicou golpe no NPC da esquina", "assaltou o cofre do vilão"];
const CRIMES_RUIM = ["tropeçou na fuga e foi pego", "foi dedurado pelo papagaio", "esqueceu a máscara em casa", "caiu na armadilha da polícia"];
def(["crime", "roubarbanco", "assalto"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const falta = 2 * HORA - (Date.now() - (m.ultimoCrime || 0));
  if (falta > 0) return c.responder(`🚔 A polícia ainda está de olho em você. Tente de novo em *${espera(falta)}*.`);
  m.ultimoCrime = Date.now();
  if (chance(0.45)) {
    const valor = ganho("crime", sorteio(200, 676), m);
    m.carteira += valor;
    marcar(c.jid);
    return c.responder(`🦹 ${marca(c.autorJid)} ${aleatorioDe(CRIMES_OK)} e fugiu com *${moedas(valor)}*!`, [c.autorJid]);
  }
  const multa = Math.min(m.carteira, sorteio(100, 1460));
  m.carteira -= multa;
  paraCaixa(c.jid, multa, "crime");
  marcar(c.jid);
  return c.responder(`🚨 ${marca(c.autorJid)} ${aleatorioDe(CRIMES_RUIM)}. Multa: *${moedas(multa)}*.${multa ? "" : " _(Sua mão estava vazia; o banco é seguro.)_"}`, [c.autorJid]);
});

def(["roubar", "furtar", "roubarpoupanca", "roubarpoupança", "assaltarpoupanca"], G, async (c) => {
  if (!exigir(c, "roubo")) return;
  const naPoupanca = /poupan/i.test(c.cmd || "") || valoresDe(c).some((a) => /^poup/i.test(a));
  const onde = naPoupanca ? "poupança" : "carteira";
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`🥷 *ROUBAR*\n\nUse: *${c.prefixo}roubar @fulano* (ou responda a mensagem da pessoa)\n\n• Sem valor: leva de 5% a 15% da carteira dela (40% de chance).\n• Com valor: *${c.prefixo}roubar @fulano 500* (ou *tudo* / *metade*). Você escolhe quanto, mas quanto maior a fatia, menor a chance (de 50% até 8%) e, se for pego(a), paga metade do valor de multa pra vítima.\n\n🐷 *Poupança:* *${c.prefixo}roubar @fulano poupanca* (ou com valor: *${c.prefixo}roubar @fulano poupanca 500*). É mais protegida: sem valor leva de 3% a 10% (30% de chance); com valor, a chance vai de 35% até 5%.\n\n_O que está no banco não pode ser roubado._`);
  if (mesmaPessoa(c, alvo, c.autorJid)) return c.responder("Roubar a si mesmo? Só se for o coração. 😏");
  if (ehOBot(c, alvo)) return c.responder("Me roubar? Eu vejo tudo. 👁️🌸");
  if (!noGrupo(c, alvo)) return c.responder("Essa pessoa não está no grupo.");
  if (protegidoVip(c, alvo)) return;
  const eu = conta(c.jid, c.autorJid);
  const vitima = conta(c.jid, alvo);
  if (vitima.congelado) return c.responder(`🧊 A conta de ${marca(alvo)} está congelada.`, [alvo]);
  const falta = CFG_JOGO().rouboMin * MIN - (Date.now() - (eu.ultimoRoubo || 0));
  if (falta > 0) return c.responder(`🕶️ Melhor esperar a poeira baixar. Tente em *${espera(falta)}*.`);
  const saldo = () => Math.floor(naPoupanca ? (vitima.poupanca?.valor || 0) : vitima.carteira);
  const tirar = (v) => { if (naPoupanca) vitima.poupanca.valor -= v; else vitima.carteira -= v; };
  if (saldo() < 200) return c.responder(naPoupanca ? `🐷 A poupança de ${marca(alvo)} está quase vazia. Nem vale o risco. 🫥` : `${marca(alvo)} está com a carteira quase vazia. Nem vale o risco. 🫥`, [alvo]);
  if (Date.now() - (vitima.roubadoEm || 0) < CFG_JOGO().rouboMin * MIN) return c.responder(`${marca(alvo)} acabou de ser roubado(a) e está atento(a). Tente mais tarde.`, [alvo]);
  const pedidoTxt = valoresDe(c).find((a) => !/^\+?\d{10,}$/.test(a) && !/^poup/i.test(a) && lerValor(a, saldo()) > 0);
  const pedido = pedidoTxt ? lerValor(pedidoTxt, saldo()) : 0;
  if (pedidoTxt && pedido > saldo()) return c.responder(`${marca(alvo)} só tem ${moedas(saldo())} na ${onde}. Escolha um valor até isso.`, [alvo]);
  const fatia = pedido ? pedido / saldo() : 0;
  const chanceRoubo = naPoupanca ? (pedido ? Math.max(0.05, 0.35 - 0.3 * fatia) : 0.3) : (pedido ? Math.max(0.08, 0.5 - 0.42 * fatia) : 0.4);
  eu.ultimoRoubo = Date.now();
  if (chance(chanceRoubo)) {
    const valor = pedido || Math.floor(saldo() * (naPoupanca ? sorteio(3, 10) : sorteio(5, 15)) / 100);
    tirar(valor); eu.carteira += valor; vitima.roubadoEm = Date.now();
    marcar(c.jid);
    return c.responder(`🥷 ${marca(c.autorJid)} roubou *${moedas(valor)}* ${naPoupanca ? "da 🐷 poupança" : "da carteira"} de ${marca(alvo)}!${pedido ? ` _(chance era de ${Math.round(chanceRoubo * 100)}%)_` : ""}\n_Dica: só o ${c.prefixo}banco (VIP) fica totalmente seguro._`, [c.autorJid, alvo]);
  }
  const multa = Math.min(eu.carteira, pedido ? Math.max(200, Math.floor(pedido / 2)) : sorteio(200, 500));
  eu.carteira -= multa; vitima.carteira += multa;
  marcar(c.jid);
  return c.responder(`🚓 ${marca(c.autorJid)} tentou roubar ${naPoupanca ? "a poupança de" : ""} ${marca(alvo)}, foi pego(a) e pagou *${moedas(multa)}* de indenização.`.replace("  ", " "), [c.autorJid, alvo]);
});

def(["banco", "bank"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const [acao, qtd] = [String(c.args[0] || "").toLowerCase(), c.args[1]];
  if (!["depositar", "dep", "sacar", "saque"].includes(acao)) {
    return c.responder(`🏦 *BANCO SORA*\n\n💵 Na mão: ${moedas(m.carteira)}\n🏦 Guardado: ${moedas(m.banco)}\n\n` +
      `🔐 Senha: ${m.senhaBanco ? "✅ configurada" : `❌ *não configurada* — mande *${c.prefixo}senhacriar 4821* no meu privado`}\n\n` +
      `• *${c.prefixo}banco depositar 500* (ou *tudo*) 💎 _só VIP_\n• *${c.prefixo}banco sacar 500* _(todos)_\n\n_O banco protege do ${c.prefixo}roubar, mas quem descobrir sua senha pode assaltar 10% a 40% com o ${c.prefixo}assaltarbanco. Troque a senha quando quiser com o ${c.prefixo}senhatrocar._`);
  }
  const depositar = acao.startsWith("dep");
  if (depositar && !ehVipConta(m) && !c.ehDono) {
    return c.responder(`💎 *Guardar no banco agora é só para VIP.*\n\n` +
      `O que você já tem lá continua seu: dá pra sacar quando quiser com *${c.prefixo}banco sacar 500* (ou *tudo*).\n\n` +
      `Quer deixar suas moedas a salvo do ${c.prefixo}roubar? Vira VIP: *${c.prefixo}vip* 🌸\n_Sem VIP, a ${c.prefixo}poupanca ainda guarda e rende um pouquinho (mas pode ser roubada)._`);
  }
  const valor = lerValor(qtd, depositar ? m.carteira : m.banco);
  if (!(valor > 0)) return c.responder(`Diga o valor: *${c.prefixo}banco ${depositar ? "depositar" : "sacar"} 500* (ou *tudo*).`);
  if (!m.senhaBanco) return c.responder(`🔐 Para ${depositar ? "depositar" : "sacar"}, crie primeiro a senha do seu banco no meu *privado*:\n*${c.prefixo}senhacriar 4821* (4 a 6 números)`);
  if (depositar ? valor > m.carteira : valor > m.banco) return c.responder(`Você não tem ${moedas(valor)} ${depositar ? "na mão" : "no banco"}.`);
  if (depositar) { m.carteira -= valor; m.banco += valor; } else { m.banco -= valor; m.carteira += valor; }
  marcar(c.jid);
  return c.responder(`${depositar ? "📥 Depositado" : "📤 Sacado"}: *${moedas(valor)}*\n💵 Na mão: ${moedas(m.carteira)} · 🏦 Banco: ${moedas(m.banco)}`);
});
def(["depositar", "dep"], G, async (c) => { c.args = ["depositar", ...c.args]; return C.find((x) => x.nomes[0] === "banco").run(c); });
def(["sacar", "saque"], G, async (c) => { c.args = ["sacar", ...c.args]; return C.find((x) => x.nomes[0] === "banco").run(c); });

def(["transferir", "enviarmoedas", "doar"], G, async (c) => {
  const cfg = exigir(c);
  if (!cfg) return;
  const alvo = alvoMarcado(c);
  const m = conta(c.jid, c.autorJid);
  const valor = lerValor(valoresDe(c)[0], m.carteira);
  if (!alvo || !(valor > 0)) return c.responder(`Use: *${c.prefixo}transferir @fulano 500*`);
  if (mesmaPessoa(c, alvo, c.autorJid)) return c.responder("Transferir para você mesmo não muda nada. 😄");
  if (ehOBot(c, alvo) || !noGrupo(c, alvo)) return c.responder("Só dá para transferir para quem está no grupo.");
  if (dividaAtrasada(c.jid, c.autorJid)) return c.responder(`📛 Caloteiro(a) não transfere. Quite sua dívida com *${c.prefixo}pagardivida* primeiro.`);
  if (valor > m.carteira) return c.responder(`Você só tem ${moedas(m.carteira)} na mão.`);
  if (Date.now() - (m.criadoEm || 0) < DIA) return c.responder(`⏳ Contas novas só podem transferir depois de 24 h no RPG. Faltam ${espera(DIA - (Date.now() - m.criadoEm))}.`);
  if (conta(c.jid, alvo).congelado) return c.responder(`🧊 A conta de ${marca(alvo)} está congelada e não pode receber moedas.`, [alvo]);
  const destino = conta(c.jid, alvo);
  const lim = limiteEnvio(cfg, m, destino);
  if (lim.resta < valor) return c.responder(textoLimite(cfg, lim), [alvo]);
  m.carteira -= valor; destino.carteira += valor; m.transfTotal += valor;
  marcar(c.jid);
  return c.responder(`💸 ${marca(c.autorJid)} enviou *${moedas(valor)}* para ${marca(alvo)}.${lim.ajuda ? `\n🤲 _Ajuda a quem tem menos: limite de hoje ${moedas(lim.limite)}._` : ""}\n_Moedas são só do jogo: não venda nem compre moedas por dinheiro._`, [c.autorJid, alvo]);
});

const AJUDA_PROPORCAO = 5, AJUDA_MULT = 3;
function limiteEnvio(cfg, m, destino) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (m.transfDia !== hoje) { m.transfDia = hoje; m.transfTotal = 0; }
  const ajuda = patrimonio(destino) * AJUDA_PROPORCAO <= patrimonio(m);
  const limite = cfg.transferenciaDia * (ajuda ? AJUDA_MULT : 1);
  return { ajuda, limite, resta: Math.max(0, limite - (m.transfTotal || 0)) };
}
const textoLimite = (cfg, lim) => `📏 Limite de envio de hoje: ${moedas(lim.limite)}${lim.ajuda ? " (ajuda a quem tem menos)" : ""}. Você ainda pode enviar ${moedas(lim.resta)}.` +
  (lim.ajuda ? "" : `\n_Para quem tem até 1/5 do seu patrimônio, o limite sobe para ${moedas(cfg.transferenciaDia * AJUDA_MULT)} por dia._`);

const NEGOCIACAO = 10 * MIN, PRAZO_EMP = HORA;
const EMP_MIN = 100, JUROS_PADRAO = 10, MAX_COMO_CREDOR = 3;

const propostas = new Map();
const avisosEmp = [];

const emprestimosDe = () => contasGlobais().emprestimos;
const salvarIndiceEmp = () => { gSujo = true; };
const restante = (e) => Math.max(0, e.divida - (e.pago || 0));
const dividaDe = (jid, id) => emprestimosDe(jid).find((e) => e.devedor === chave(jid, id)) || null;
export const dividaAtrasada = (jid, id) => { const e = dividaDe(jid, id); return e?.atrasado ? e : null; };
const minhasProps = (jid, k) => [...propostas.values()].filter((p) => p.jid === jid && (p.credor === k || p.devedor === k));
const lerJuros = (t) => { const n = Number(String(t ?? "").replace("%", "").replace(",", ".")); return t === undefined || t === "" ? JUROS_PADRAO : n; };

function crescerDivida(e, agora = Date.now()) {
  if (!e.atrasado || !(e.juros > 0)) return 0;
  const desde = e.juroEm || e.venceEm;
  const vezes = Math.floor((agora - desde) / (CFG_JOGO().juroHoras * HORA));
  if (vezes < 1) return 0;
  const teto = Math.ceil(e.valor * CFG_JOGO().tetoDivida) + (e.pago || 0);
  const antes = e.divida;
  for (let i = 0; i < Math.min(vezes, 500) && e.divida < teto; i++) e.divida = Math.min(teto, e.divida + Math.ceil(restante(e) * e.juros / 100));
  e.juroEm = desde + vezes * (CFG_JOGO().juroHoras * HORA);
  e.cresceu = (e.cresceu || 0) + (e.divida - antes);
  return e.divida - antes;
}
const disponivelDe = (m) => Math.floor(m.carteira || 0) + Math.floor(m.banco || 0) + Math.floor(m.poupanca?.valor || 0);

function cobrarAtrasados() {
  if (tx) return;
  const lista = emprestimosDe();
  if (!lista.some((e) => e.atrasado)) return;
  for (const e of [...lista]) {
    if (!e.atrasado) continue;
    const jid = e.jid || "";
    const m = conta(jid, e.devedor);
    crescerDivida(e);
    const precisa = restante(e), tem = disponivelDe(m);
    if (precisa <= 0 || tem < Math.ceil(precisa / 2)) { marcar(jid); continue; }
    const tudo = tem >= precisa;
    let falta = restante(e), tirou = 0;
    for (const onde of ["carteira", "banco", "poupanca"]) {
      if (falta <= 0) break;
      const tem = onde === "poupanca" ? Math.floor(m.poupanca?.valor || 0) : Math.floor(m[onde] || 0);
      const v = Math.min(tem, falta);
      if (v <= 0) continue;
      if (onde === "poupanca") m.poupanca.valor -= v; else m[onde] -= v;
      falta -= v; tirou += v;
    }
    if (!tirou) continue;
    const cred = conta(jid, e.credor);
    cred.carteira = Math.min(LIMITE, cred.carteira + tirou);
    e.pago = (e.pago || 0) + tirou;
    anotar(m, "cobrança da dívida", -tirou, e.credor);
    anotar(cred, "cobrança recebida", tirou, e.devedor);
    if (restante(e) <= 0) {
      lista.splice(lista.indexOf(e), 1);
      if (ehGrupo(jid)) avisosEmp.push({ jid, texto: `✅ *DÍVIDA QUITADA AUTOMATICAMENTE!*\n${mk(jid, e.devedor)} juntou o dinheiro e eu cobrei *${moedas(tirou)}* para ${mk(jid, e.credor)}.${e.cresceu ? `\n📈 Com o atraso, a dívida tinha crescido *${moedas(e.cresceu)}*.` : ""}\nA marca de caloteiro saiu.`, mencoes: [jidDe(jid, e.devedor), jidDe(jid, e.credor)] });
    } else if (!tudo && ehGrupo(jid)) {
      avisosEmp.push({ jid, texto: `💳 *COBRANÇA AUTOMÁTICA*\n${mk(jid, e.devedor)} tinha pelo menos metade da dívida, então eu cobrei *${moedas(tirou)}* para ${mk(jid, e.credor)}.\n❗ Ainda falta *${moedas(restante(e))}* e continua crescendo ${e.juros}% a cada hora.`, mencoes: [jidDe(jid, e.devedor), jidDe(jid, e.credor)] });
    }
    marcar(jid);
  }
  salvarIndiceEmp();
}

export function verificarEmprestimos() {
  if (tx) return;
  const agora = Date.now();
  for (const [k, p] of propostas) {
    if (p.expira > agora) continue;
    propostas.delete(k);
    avisosEmp.push({ jid: p.jid, texto: `⌛ A negociação do empréstimo entre ${mk(p.jid, p.credor)} e ${mk(p.jid, p.devedor)} acabou sem acordo.`, mencoes: [jidDe(p.jid, p.credor), jidDe(p.jid, p.devedor)] });
  }
  {
    for (const e of [...emprestimosDe()]) {
      if (e.atrasado || e.venceEm > agora) continue;
      e.atrasado = agora;
      const jid = e.jid || "";
      const m = conta(jid, e.devedor);
      m.calotes = (m.calotes || 0) + 1;
      marcar(jid);
      e.juroEm = e.venceEm;
      const antes = restante(e);
      cobrarAtrasados();
      const depois = emprestimosDe().includes(e) ? restante(e) : 0;
      if (ehGrupo(jid)) avisosEmp.push({ jid, mencoes: [jidDe(jid, e.devedor), jidDe(jid, e.credor)], texto:
        `📛 *CALOTE!* ${mk(jid, e.devedor)} não pagou ${mk(jid, e.credor)} dentro de 1 hora.\n\n` +
        `🧾 Devia: ${moedas(antes)}\n🏦 Cobrança automática: ${moedas(antes - depois)}\n` +
        (depois > 0 ? `❗ Falta: *${moedas(depois)}*\n📈 A partir de agora a dívida cresce *${e.juros}% a cada ${CFG_JOGO().juroHoras > 1 ? `${CFG_JOGO().juroHoras} horas` : "hora"}* (até ${moedas(e.valor * CFG_JOGO().tetoDivida)}). Quando ${mk(jid, e.devedor)} tiver o valor (ou metade), eu cobro sozinha.\n\nAté quitar, ${mk(jid, e.devedor)} fica com a marca de *caloteiro(a)*, não transfere, não pega nem dá empréstimo, e tudo o que ganhar no RPG (em qualquer grupo) vai direto para ${mk(jid, e.credor)}.` : `✅ Deu para cobrar tudo. Dívida quitada.`) });
    }
    cobrarAtrasados();
  }
}
export async function enviarAvisosEmp(sock = null) {
  if (!avisosEmp.length) return;
  sock ||= (await import("./conexao.js").catch(() => null))?.sockAtual?.();
  if (!sock) return;
  while (avisosEmp.length) {
    const a = avisosEmp.shift();
    await sock.sendMessage(a.jid, { text: a.texto, mentions: a.mencoes }).catch(() => {});
  }
}
setInterval(() => { try { verificarEmprestimos(); } catch {} enviarAvisosEmp().catch(() => {}); }, 30_000).unref?.();

function impedimento(c, cfg, k, papel) {
  const quem = `${mk(c.jid, k)}`;
  const m = conta(c.jid, jidDe(c.jid, k));
  if (m.congelado) return `🧊 A conta de ${quem} está congelada.`;
  if (Date.now() - (m.criadoEm || 0) < DIA) return `⏳ ${quem} tem conta nova no RPG (menos de 24 h) e ainda não pode usar empréstimos.`;
  if (dividaAtrasada(c.jid, k)) return `📛 ${quem} está com dívida atrasada (caloteiro). Precisa quitar antes.`;
  if (papel === "devedor" && dividaDe(c.jid, k)) return `🧾 ${quem} já tem um empréstimo para pagar. Um de cada vez.`;
  if (papel === "credor" && emprestimosDe(c.jid).filter((e) => e.credor === k).length >= MAX_COMO_CREDOR) return `💼 ${quem} já tem ${MAX_COMO_CREDOR} empréstimos em aberto como credor(a).`;
  return null;
}
function conferirTermos(cfg, valor, juros) {
  if (!(valor >= EMP_MIN)) return `O empréstimo mínimo é ${moedas(EMP_MIN)}.`;
  if (!(Number.isFinite(juros) && juros >= 0 && juros <= CFG_JOGO().jurosMax)) return `Os juros vão de 0 a ${CFG_JOGO().jurosMax}%.`;
  return null;
}
const comJuros = (valor, juros) => Math.ceil(valor * (1 + juros / 100));
const textoProposta = (c, p) => `🤝 *PROPOSTA DE EMPRÉSTIMO*\n\n` +
  `💰 ${mk(c.jid, p.credor)} empresta para ${mk(c.jid, p.devedor)}\n💵 Valor: *${moedas(p.valor)}*\n📈 Juros: *${p.juros}%*\n🧾 Devolver: *${moedas(comJuros(p.valor, p.juros))}* em até *1 hora*\n📈 Atrasou? A dívida cresce *${p.juros}% a cada hora* (até ${moedas(p.valor * CFG_JOGO().tetoDivida)})\n\n` +
  `👉 ${mk(c.jid, p.aguarda === "devedor" ? p.devedor : p.credor)}, responda:\n• *${c.prefixo}emprestimo aceitar*\n• *${c.prefixo}contraproposta valor juros* (ex.: ${c.prefixo}contraproposta ${Math.floor(p.valor * 0.8)} 5)\n• *${c.prefixo}emprestimo recusar*\n\n` +
  `⏳ Negociação fecha em *${espera(p.expira - Date.now())}*.\n_Se não pagar no prazo: cobrança automática e marca de caloteiro (ninguém é removido do grupo)._`;
const mencoesProp = (c, p) => [jidDe(c.jid, p.credor), jidDe(c.jid, p.devedor)];

function abrirProposta(c, comoCredor) {
  const cfg = exigir(c, "emprestimo");
  if (!cfg) return;
  const alvo = alvoMarcado(c);
  const [vTxt, jTxt] = valoresDe(c);
  const cmd = comoCredor ? "emprestar" : "pediremprestimo";
  if (!alvo || !vTxt) return c.responder(`Use: *${c.prefixo}${cmd} @fulano 1000 10*\n_(valor e juros em %; sem juros, vale ${JUROS_PADRAO}%)_`);
  if (mesmaPessoa(c, alvo, c.autorJid)) return c.responder("Emprestar para si mesmo? Isso se chama carteira. 😄");
  if (ehOBot(c, alvo) || !noGrupo(c, alvo)) return c.responder("Só dá para negociar com quem está no grupo.");
  const eu = chave(c.jid, c.autorJid), outro = chave(c.jid, alvo);
  const [credor, devedor] = comoCredor ? [eu, outro] : [outro, eu];
  const valor = lerValor(vTxt, conta(c.jid, jidDe(c.jid, credor)).carteira), juros = lerJuros(jTxt);
  const erro = conferirTermos(cfg, valor, juros) || impedimento(c, cfg, credor, "credor") || impedimento(c, cfg, devedor, "devedor");
  if (erro) return c.responder(erro, [alvo]);
  if (minhasProps(c.jid, eu).length || minhasProps(c.jid, outro).length) return c.responder(`Já tem uma negociação aberta envolvendo vocês. Veja em *${c.prefixo}emprestimo*.`);
  const p = { jid: c.jid, credor, devedor, valor, juros, aguarda: comoCredor ? "devedor" : "credor", expira: Date.now() + NEGOCIACAO };
  propostas.set(`${c.jid}|${devedor}`, p);
  return c.responder(textoProposta(c, p), mencoesProp(c, p));
}
def(["emprestar", "emprestarmoedas"], G, async (c) => abrirProposta(c, true));
def(["pediremprestimo", "pedirempréstimo", "pedirgrana"], G, async (c) => abrirProposta(c, false));

def(["contraproposta", "contrapropor"], G, async (c) => {
  const cfg = exigir(c, "emprestimo");
  if (!cfg) return;
  const eu = chave(c.jid, c.autorJid);
  const p = minhasProps(c.jid, eu)[0];
  if (!p) return c.responder(`Você não tem negociação aberta. Comece com *${c.prefixo}emprestar @fulano valor juros*.`);
  if (p[p.aguarda] !== eu) return c.responder(`Agora é a vez de ${mk(c.jid, p[p.aguarda])} responder.`, [jidDe(c.jid, p[p.aguarda])]);
  const [vTxt, jTxt] = c.args;
  const valor = lerValor(vTxt, p.valor), juros = jTxt === undefined ? p.juros : lerJuros(jTxt);
  const erro = conferirTermos(cfg, valor, juros);
  if (erro) return c.responder(`${erro}\nUse: *${c.prefixo}contraproposta valor juros*`);
  p.valor = valor; p.juros = juros; p.aguarda = p.aguarda === "devedor" ? "credor" : "devedor";
  return c.responder(`🔁 *CONTRAPROPOSTA*\n\n${textoProposta(c, p)}`, mencoesProp(c, p));
});

def(["emprestimo", "empréstimo", "emprestimos", "dividas", "dívidas", "divida"], G, async (c) => {
  const cfg = exigir(c, "emprestimo");
  if (!cfg) return;
  const eu = chave(c.jid, c.autorJid);
  const acao = String(c.args[0] || "").toLowerCase();
  const p = minhasProps(c.jid, eu)[0];
  if (["aceitar", "aceito", "sim"].includes(acao)) {
    if (!p) return c.responder("Não tem proposta de empréstimo esperando você.");
    if (p[p.aguarda] !== eu) return c.responder(`Quem precisa aceitar é ${mk(c.jid, p[p.aguarda])}.`, [jidDe(c.jid, p[p.aguarda])]);
    const erro = conferirTermos(cfg, p.valor, p.juros) || impedimento(c, cfg, p.credor, "credor") || impedimento(c, cfg, p.devedor, "devedor");
    if (erro) { propostas.delete(`${c.jid}|${p.devedor}`); return c.responder(`${erro}\nNegociação cancelada.`, mencoesProp(c, p)); }
    const cred = conta(c.jid, jidDe(c.jid, p.credor)), dev = conta(c.jid, jidDe(c.jid, p.devedor));
    if (cred.carteira < p.valor) return c.responder(`${mk(c.jid, p.credor)} só tem ${moedas(cred.carteira)} na mão. Precisa sacar do banco ou mandar uma contraproposta menor.`, mencoesProp(c, p));
    propostas.delete(`${c.jid}|${p.devedor}`);
    cred.carteira -= p.valor; dev.carteira += p.valor; cred.transfTotal += p.valor;
    const e = { id: Date.now().toString(36), jid: c.jid, credor: p.credor, devedor: p.devedor, valor: p.valor, juros: p.juros, divida: comJuros(p.valor, p.juros), pago: 0, criadoEm: Date.now(), venceEm: Date.now() + PRAZO_EMP };
    emprestimosDe(c.jid).push(e);
    salvarIndiceEmp(c.jid);
    marcar(c.jid);
    return c.responder(`✅ *EMPRÉSTIMO FECHADO!*\n\n${mk(c.jid, e.credor)} emprestou *${moedas(e.valor)}* para ${mk(c.jid, e.devedor)}.\n🧾 Devolver: *${moedas(e.divida)}* (${e.juros}% de juros)\n⏰ Prazo: *1 hora* (até ${new Date(e.venceEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })})\n\n💳 Para pagar: *${c.prefixo}pagardivida* (ou *${c.prefixo}pagardivida 500*)\n_Sem pagamento no prazo: marca de caloteiro e a dívida cresce ${e.juros}% a cada hora (até ${moedas(e.valor * CFG_JOGO().tetoDivida)}). Quando o devedor tiver o valor ou metade, eu cobro sozinha._`, mencoesProp(c, e));
  }
  if (["recusar", "recuso", "nao", "não", "cancelar"].includes(acao)) {
    if (!p) return c.responder("Você não tem negociação aberta.");
    propostas.delete(`${c.jid}|${p.devedor}`);
    return c.responder(`❌ Negociação entre ${mk(c.jid, p.credor)} e ${mk(c.jid, p.devedor)} cancelada por ${mk(c.jid, eu)}.`, mencoesProp(c, p));
  }
  const alvo = alvoMarcado(c);
  const k = alvo ? chave(c.jid, alvo) : eu;
  const devo = dividaDe(c.jid, jidDe(c.jid, k));
  const recebo = emprestimosDe(c.jid).filter((e) => e.credor === k);
  const m = conta(c.jid, jidDe(c.jid, k));
  const linhaDiv = (e, comQuem) => { crescerDivida(e); return `• ${comQuem}: *${moedas(restante(e))}*${e.atrasado ? ` 📛 *atrasada*${e.juros > 0 ? ` · 📈 +${e.juros}%/h (próximo em ${espera((CFG_JOGO().juroHoras * HORA) - ((Date.now() - (e.juroEm || e.venceEm)) % (CFG_JOGO().juroHoras * HORA)))})` : ""}` : ` · vence em ${espera(e.venceEm - Date.now())}`}`; };
  const txt = `🤝 *EMPRÉSTIMOS* — ${mk(c.jid, k)}\n\n` +
    (p && !alvo ? `📝 Negociando com ${mk(c.jid, p.credor === k ? p.devedor : p.credor)}: ${moedas(p.valor)} a ${p.juros}% (vez de ${mk(c.jid, p[p.aguarda])})\n\n` : "") +
    `🧾 *Deve:*\n${devo ? linhaDiv(devo, `para ${mk(c.jid, devo.credor)}`) : "• nada"}\n\n💰 *Tem para receber:*\n${recebo.length ? recebo.map((e) => linhaDiv(e, `de ${mk(c.jid, e.devedor)}`)).join("\n") : "• nada"}\n\n` +
    (m.calotes ? `📛 Calotes no histórico: *${m.calotes}*\n\n` : "") +
    `*Comandos:*\n• ${c.prefixo}emprestar @fulano valor juros\n• ${c.prefixo}pediremprestimo @fulano valor juros\n• ${c.prefixo}contraproposta valor juros\n• ${c.prefixo}emprestimo aceitar / recusar\n• ${c.prefixo}pagardivida [valor]\n• ${c.prefixo}perdoardivida @fulano\n\n` +
    `_Negociação: 10 min · prazo: 1 h · juros até ${CFG_JOGO().jurosMax}% · sem valor máximo\nAtrasou: a dívida cresce os juros a cada ${CFG_JOGO().juroHoras > 1 ? `${CFG_JOGO().juroHoras} h` : "hora"} (até ${CFG_JOGO().tetoDivida}× o valor) e é cobrada sozinha quando o devedor tiver o valor ou metade._`;
  const mm = [jidDe(c.jid, k), ...(devo ? [jidDe(c.jid, devo.credor)] : []), ...recebo.map((e) => jidDe(c.jid, e.devedor)), ...(p ? mencoesProp(c, p) : [])];
  return c.responder(txt, [...new Set(mm)]);
});
def(["aceitaremprestimo", "aceitarempréstimo"], G, async (c) => { c.args = ["aceitar"]; return C.find((x) => x.nomes[0] === "emprestimo").run(c); });
def(["recusaremprestimo", "recusarempréstimo"], G, async (c) => { c.args = ["recusar"]; return C.find((x) => x.nomes[0] === "emprestimo").run(c); });

def(["pagardivida", "pagardívida", "pagaremprestimo", "quitar"], G, async (c) => {
  if (!exigir(c, "emprestimo")) return;
  const e = dividaDe(c.jid, c.autorJid);
  if (!e) return c.responder("Você não deve nada. 😌");
  crescerDivida(e);
  const m = conta(c.jid, c.autorJid);
  const falta = restante(e);
  const valor = Math.min(falta, c.args[0] ? lerValor(c.args[0], Math.min(m.carteira, falta)) : Math.min(m.carteira, falta));
  if (!(valor > 0)) return c.responder(`Você não tem moedas na mão. Faltam ${moedas(falta)}.\n_Saque do banco com ${c.prefixo}sacar e tente de novo._`);
  if (valor > m.carteira) return c.responder(`Você só tem ${moedas(m.carteira)} na mão.`);
  const cred = conta(c.jid, jidDe(c.jid, e.credor));
  m.carteira -= valor; cred.carteira = Math.min(LIMITE, cred.carteira + valor); e.pago = (e.pago || 0) + valor;
  const mm = [c.autorJid, jidDe(c.jid, e.credor)];
  marcar(c.jid);
  if (restante(e) > 0) return c.responder(`💳 ${mk(c.jid, e.devedor)} pagou *${moedas(valor)}* para ${mk(c.jid, e.credor)}.\n🧾 Ainda falta: *${moedas(restante(e))}*${e.atrasado ? "" : ` · vence em ${espera(e.venceEm - Date.now())}`}`, mm);
  emprestimosDe(c.jid).splice(emprestimosDe(c.jid).indexOf(e), 1);
  salvarIndiceEmp(c.jid);
  return c.responder(`✅ *DÍVIDA QUITADA!* ${mk(c.jid, e.devedor)} pagou tudo para ${mk(c.jid, e.credor)}.${e.atrasado ? "\nA marca de caloteiro saiu." : " Bom pagador(a)! 🤝"}`, mm);
});

def(["perdoardivida", "perdoardívida", "perdoar"], G, async (c) => {
  if (!exigir(c, "emprestimo")) return;
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}perdoardivida @fulano* (só quem emprestou pode perdoar)`);
  const e = dividaDe(c.jid, alvo);
  if (!e || e.credor !== chave(c.jid, c.autorJid)) return c.responder(`${marca(alvo)} não deve nada para você.`, [alvo]);
  emprestimosDe(c.jid).splice(emprestimosDe(c.jid).indexOf(e), 1);
  salvarIndiceEmp(c.jid);
  marcar(c.jid);
  return c.responder(`🕊️ ${mk(c.jid, e.credor)} perdoou a dívida de ${marca(alvo)} (${moedas(restante(e))}).${e.atrasado ? " A marca de caloteiro saiu." : ""}`, [c.autorJid, alvo]);
});

export const TERMOS_VERSAO = "2026-10-18";
const RESUMO_TERMOS = (p) => `📜 *TERMOS DO RPG*\n\n` +
  `• Apostas e ações podem fazer você perder moedas.\n` +
  `• Moedas não são dinheiro: sem saque.\n\n` +
  `Para aceitar: *${p}aceitotermos1*`;
const termosOk = (m) => m.termos?.versao === TERMOS_VERSAO;
export const aceitouTermos = (jid, id) => termosOk(conta(jid, id));
function exigirTermos(c, m) {
  if (termosOk(m)) return true;
  c.responder(`${m.termos ? "📜 Os termos do RPG mudaram. " : ""}${RESUMO_TERMOS(c.prefixo)}`);
  return false;
}
def(["termosrpg", "regrasrpg", "termos1"], {}, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  return c.responder(`${RESUMO_TERMOS(c.prefixo)}${termosOk(m) ? `\n\n✅ Você aceitou esta versão em ${new Date(m.termos.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.` : ""}`);
});
def(["aceitotermos1", "aceitartermos1", "aceitotermosrpg", "aceitorpg"], {}, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  if (termosOk(m)) return c.responder(`✅ Você já aceitou a versão ${TERMOS_VERSAO} em ${new Date(m.termos.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`);
  m.termos = { versao: TERMOS_VERSAO, em: Date.now() };
  m.termosHist = [...(m.termosHist || []), { versao: TERMOS_VERSAO, em: m.termos.em }].slice(-10);
  marcar(c.jid);
  return c.responder(`✅ ${marca(c.autorJid)} aceitou os Termos do RPG (versão ${TERMOS_VERSAO}).\nApostas e ações liberadas. Lembre: dá para perder moedas e não há garantia de lucro.`, [c.autorJid]);
});

const VERMELHOS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SLOT = [["🍒", 30], ["🍋", 25], ["🔔", 20], ["⭐", 13], ["💎", 8], ["7️⃣", 4]];
const SLOT_TRIO = { "🍒": 5, "🍋": 8, "🔔": 14, "⭐": 35, "💎": 100, "7️⃣": 400 };
const SLOT_PAR = 0.7;
function embaralhar(lista) { const a = [...lista]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(aleatorio() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function giro() { let r = aleatorio() * 100; for (const [s, p] of SLOT) { if ((r -= p) < 0) return s; } return "🍒"; }
const ultimaAposta = new Map();
const AJUDA_APOSTA = (p) => `🎰 *CASSINO DA HINA*\n_Ganhou, recebe o valor cheio: apostou 100 num jogo de 2×, recebe 200._\n\n` +
  `• *${p}apostar moeda 100 cara* — cara ou coroa (2×) · rarinho, ela pode cair em pé\n` +
  `• *${p}apostar dado 100 4* — acerte o número de 1 a 6 (6×) · o dado tem uma face ☠️\n` +
  `• *${p}apostar roleta 100 vermelho* — vermelho/preto/par/ímpar 2× · verde 12× (0, 00 e 000) · número 36×\n` +
  `• *${p}apostar slot 100* — caça-níquel 🍒🍋🔔⭐💎7️⃣ (três 7️⃣ pagam 400×)\n` +
  `• *${p}apostar corrida 100 3* — cavalo de 1 a 5 (5×) · o 👑 cavalo da Hina também corre\n` +
  `• *${p}apostar foguete 100 2.5* — o foguete precisa passar do seu multiplicador (1.1 a 50) antes de explodir; paga exatamente ele\n` +
  `• *${p}apostar raspadinha 100* — raspe 3 casas: 🍒 2× · ⭐ 4× · 🍀 10× · 💎 50×\n` +
  `• *${p}apostar dados 100 maior* — soma de 2 dados *maior* ou *menor* que 7 (2×) ou *sete* (5×)\n` +
  `• *${p}apostar penalti 100 esquerda* — gol paga 2× · goleiro e trave atrapalham\n` +
  `• *${p}apostar copos 100 2* — ache a bolinha (3×) · cuidado com o truque da Hina\n` +
  `• *${p}apostar minas 100 3* — abra de 2 a 5 casas num campo com 3 bombas (2× até 17×)\n` +
  `• *${p}apostar jokenpo 100 pedra* — vitória 2× · empate devolve 60%\n` +
  `• *${p}apostar carta 100* — carta maior que a da Hina 2× · empate e coringa são da Hina\n` +
  `• *${p}apostar cofre 100 7* — acerte o dígito (10×) · se o alarme tocar, perdeu\n` +
  `• *${p}apostar arremesso 100 medio* — curto 2× · médio 3× · longo 5×\n\n` +
  `💡 Valor: número, *1k*, *metade* ou *tudo* (só o que está na mão).\n` +
  `⏸️ Quer dar um tempo? *${p}pausarapostas 7* bloqueia suas apostas por 7 dias.\n` +
  `📉 *Difícil de propósito:* os prêmios são cheios, mas a chance de ganhar é baixa. Em média, os jogos devolvem de 85% a 92% do apostado: no longo prazo, a casa ganha.\n` +
  `_Você pode perder tudo o que apostar, inclusive moedas compradas. Termos: ${p}termosrpg_`;

def(["apostar", "aposta", "bet", "cassino"], G, async (c) => {
  const cfg = exigir(c, "apostas");
  if (!cfg) return;
  const jogo = String(c.args[0] || "").toLowerCase();
  if (!["moeda", "cc", "caraoucoroa", "dado", "roleta", "slot", "slots", "cacaniquel", "corrida", "cavalo", "cavalos", "foguete", "crash", "raspadinha", "raspa", "dados", "maiormenor", "penalti", "pênalti", "copos", "copo", "minas", "mines", "campominado", "jokenpo", "ppt", "carta", "cartas", "cofre", "arremesso", "basquete", "cesta"].includes(jogo)) { const menu = (await import("./comandos.js")).COMANDOS.get("menuapostas"); return menu ? menu.run(c) : c.responder(AJUDA_APOSTA(c.prefixo)); }
  const m = conta(c.jid, c.autorJid);
  if (!exigirTermos(c, m)) return;
  if (m.pausaApostasAte > Date.now()) return c.responder(`⏸️ Suas apostas estão pausadas até ${new Date(m.pausaApostasAte).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}, como você pediu.`);
  const k = `${c.jid}|${usuario(c.autorJid)}`;
  if (Date.now() - (ultimaAposta.get(k) || 0) < 5000) return c.responder("⏳ Calma! Uma aposta a cada 5 segundos.");
  const valor = lerValor(c.args[1], Math.min(m.carteira, cfg.apostaMax));
  if (!(valor >= 10)) return c.responder(`Aposta mínima: ${moedas(10)}. Ex.: *${c.prefixo}apostar ${jogo} 100${({ slot: "", raspadinha: "", raspa: "", dado: " 4", roleta: " vermelho", corrida: " 3", cavalo: " 3", cavalos: " 3", foguete: " 2.5", crash: " 2.5", dados: " maior", maiormenor: " maior", penalti: " esquerda", "pênalti": " esquerda", copos: " 2", copo: " 2", minas: " 3", mines: " 3", campominado: " 3", jokenpo: " pedra", ppt: " pedra", carta: "", cartas: "", cofre: " 7", arremesso: " curto", basquete: " curto", cesta: " curto" })[jogo] ?? " cara"}*`);
  if (valor > m.carteira) return c.responder(`Você só tem ${moedas(m.carteira)} na mão. Saque do banco com *${c.prefixo}sacar*.`);
  const escolha = String(c.args[2] || "").toLowerCase();
  let ganho = 0, texto = "";
  if (["moeda", "cc", "caraoucoroa"].includes(jogo)) {
    if (!["cara", "coroa"].includes(escolha)) return c.responder(`Escolha *cara* ou *coroa*: *${c.prefixo}apostar moeda ${valor} cara*`);
    const emPe = chance(0.02);
    const saiu = emPe ? "em pé" : chance(0.5) ? "cara" : "coroa";
    ganho = saiu === escolha ? valor * 2 : 0;
    texto = emPe ? `🪙 A moeda girou, girou… e caiu *EM PÉ*! 😱 A Hina leva.` : `🪙 A moeda girou… deu *${saiu.toUpperCase()}*!`;
  } else if (jogo === "dado") {
    const n = Number(escolha);
    if (!(n >= 1 && n <= 6 && Number.isInteger(n))) return c.responder(`Escolha um número de 1 a 6: *${c.prefixo}apostar dado ${valor} 4*`);
    const saiu = sorteio(1, 7);
    ganho = saiu === n ? valor * 6 : 0;
    texto = saiu === 7 ? `🎲 O dado rolou… *☠️ CAVEIRA*! A face da Hina.` : `🎲 O dado rolou… *${saiu}*!`;
  } else if (jogo === "roleta") {
    const casa = sorteio(0, 38);
    const rotulo = casa === 37 ? "00" : casa === 38 ? "000" : String(casa);
    const verde = casa === 0 || casa >= 37;
    const cor = verde ? "verde" : VERMELHOS.has(casa) ? "vermelho" : "preto";
    const tipos = { vermelho: cor === "vermelho", preto: cor === "preto", par: !verde && casa % 2 === 0, impar: !verde && casa % 2 === 1, "ímpar": !verde && casa % 2 === 1 };
    if (escolha in tipos) ganho = tipos[escolha] ? valor * 2 : 0;
    else if (escolha === "verde") ganho = verde ? valor * 12 : 0;
    else if (["00", "000"].includes(escolha) || (/^\d{1,2}$/.test(escolha) && Number(escolha) <= 36)) ganho = escolha === rotulo || (!["00", "000"].includes(escolha) && casa <= 36 && Number(escolha) === casa) ? valor * 36 : 0;
    else return c.responder(`Escolha *vermelho*, *preto*, *par*, *impar*, *verde*, *00*, *000* ou um número de 0 a 36.`);
    texto = `🎡 A roleta parou no *${rotulo}* ${{ verde: "🟢", vermelho: "🔴", preto: "⚫" }[cor]}`;
  } else if (["corrida", "cavalo", "cavalos"].includes(jogo)) {
    const n = Number(escolha);
    if (!(n >= 1 && n <= 5 && Number.isInteger(n))) return c.responder(`Escolha um cavalo de 1 a 5: *${c.prefixo}apostar corrida ${valor} 3*`);
    const ordem = embaralhar([1, 2, 3, 4, 5, 6]);
    ganho = ordem[0] === n ? valor * 5 : 0;
    const pista = ordem.map((cv, i) => `${["🥇", "🥈", "🥉", "4º", "5º", "6º"][i]} ${cv === 6 ? "👑 Cavalo da Hina" : `🐎 Cavalo ${cv}`}${cv === n ? " ⬅️ seu" : ""}`).join("\n");
    texto = `🏇 *CORRIDA!* Largada… e chegada:\n${pista}`;
  } else if (["foguete", "crash"].includes(jogo)) {
    const alvo = Number(String(escolha).replace(",", "."));
    if (!(alvo >= 1.1 && alvo <= 50)) return c.responder(`Escolha o multiplicador de 1.1 a 50: *${c.prefixo}apostar foguete ${valor} 2.5*`);
    const explodiu = Math.max(1, Math.floor((0.85 / Math.max(1e-9, aleatorio())) * 100) / 100);
    ganho = explodiu >= alvo ? Math.floor(valor * alvo) : 0;
    texto = `🚀 O foguete subiu… ${explodiu >= alvo ? `passou de *${alvo}×* ✅` : "💥"} e explodiu em *${explodiu.toFixed(2)}×*`;
  } else if (["dados", "maiormenor"].includes(jogo)) {
    if (!["maior", "menor", "sete", "7"].includes(escolha)) return c.responder(`Escolha *maior*, *menor* ou *sete*: *${c.prefixo}apostar dados ${valor} maior*`);
    const d1 = sorteio(1, 6), d2 = sorteio(1, 6), soma = d1 + d2;
    const deu = soma > 7 ? "maior" : soma < 7 ? "menor" : "sete";
    const alvo = escolha === "7" ? "sete" : escolha;
    ganho = deu === alvo ? valor * (alvo === "sete" ? 5 : 2) : 0;
    texto = `🎲🎲 Os dados rolaram: *${d1}* + *${d2}* = *${soma}* (${deu === "sete" ? "sete!" : deu})`;
  } else if (["penalti", "pênalti"].includes(jogo)) {
    const cantos = ["esquerda", "meio", "direita"];
    if (!cantos.includes(escolha)) return c.responder(`Escolha *esquerda*, *meio* ou *direita*: *${c.prefixo}apostar penalti ${valor} esquerda*`);
    const pulou = cantos[sorteio(0, 2)];
    const errou = pulou !== escolha && chance(0.36) ? ["na TRAVE", "por cima do gol", "para fora"][sorteio(0, 2)] : null;
    const gol = pulou !== escolha && !errou;
    ganho = gol ? valor * 2 : 0;
    texto = `⚽ Você bateu no canto *${escolha}*… o goleiro pulou na *${pulou}*!\n${gol ? "🥅 *GOOOOL!*" : errou ? `😩 A bola foi *${errou}*!` : "🧤 *DEFENDEU!*"}`;
  } else if (["copos", "copo"].includes(jogo)) {
    const n = Number(escolha);
    if (![1, 2, 3].includes(n)) return c.responder(`Escolha o copo *1*, *2* ou *3*: *${c.prefixo}apostar copos ${valor} 2*`);
    const sumiu = chance(0.15);
    const bola = sumiu ? 0 : sorteio(1, 3);
    ganho = bola === n ? valor * 3 : 0;
    texto = sumiu ? `🥤 Embaralhando os copos… levantou o copo *${n}*: vazio! Os outros também! 🪄 A bolinha estava na manga da Hina.\n🥤 🥤 🥤`
      : `🥤 Embaralhando os copos… a bolinha estava no copo *${bola}*!\n${[1, 2, 3].map((x) => (x === bola ? "⚪" : "🥤")).join(" ")}`;
  } else if (["minas", "mines", "campominado"].includes(jogo)) {
    const k = Number(escolha);
    if (!(k >= 2 && k <= 5 && Number.isInteger(k))) return c.responder(`Quantas casas abrir (de 2 a 5)? *${c.prefixo}apostar minas ${valor} 3*\n_9 casas, 3 bombas. Pagamento: 2→2× · 3→3,5× · 4→7× · 5→17×_`);
    const MULT = { 2: 2, 3: 3.5, 4: 7, 5: 17 };
    const campo = embaralhar(Array.from({ length: 9 }, (_, i) => i < 3));
    const abertas = campo.slice(0, k);
    const explodiu = abertas.includes(true);
    ganho = explodiu ? 0 : Math.floor(valor * MULT[k]);
    const vis = campo.map((b, i) => (i < k ? (b ? "💥" : "💎") : b ? "💣" : "⬜"));
    texto = `💣 *CAMPO MINADO* — abriu ${k} casa(s)\n${vis.slice(0, 3).join("")}\n${vis.slice(3, 6).join("")}\n${vis.slice(6, 9).join("")}${explodiu ? "\n💥 *BOOM!*" : `\n✅ Sobreviveu! Paga *${MULT[k]}×*`}`;
  } else if (["jokenpo", "ppt"].includes(jogo)) {
    const op = ["pedra", "papel", "tesoura"];
    if (!op.includes(escolha)) return c.responder(`Escolha *pedra*, *papel* ou *tesoura*: *${c.prefixo}apostar jokenpo ${valor} pedra*`);
    const hina = op[sorteio(0, 2)];
    const ganha = { pedra: "tesoura", papel: "pedra", tesoura: "papel" };
    const res = escolha === hina ? "empate" : ganha[escolha] === hina ? "vitoria" : "derrota";
    ganho = res === "vitoria" ? valor * 2 : res === "empate" ? Math.floor(valor * 0.6) : 0;
    const em = { pedra: "✊", papel: "✋", tesoura: "✌️" };
    texto = `${em[escolha]} você × ${em[hina]} Hina — *${res === "vitoria" ? "VOCÊ VENCEU!" : res === "empate" ? "EMPATE" : "A HINA VENCEU"}*`;
  } else if (["carta", "cartas"].includes(jogo)) {
    const NOMES = { 1: "A", 11: "J", 12: "Q", 13: "K" };
    const nome = (n) => `${NOMES[n] || n}${["♠️", "♥️", "♦️", "♣️"][sorteio(0, 3)]}`;
    const coringa = chance(0.08);
    const eu = sorteio(1, 13), ela = sorteio(1, 13);
    ganho = !coringa && eu > ela ? valor * 2 : 0;
    texto = `🃏 *CARTA ALTA*\nSua carta: *${nome(eu)}* × Hina: *${coringa ? "🃏 CORINGA" : nome(ela)}*\n${coringa ? "😈 Coringa ganha de tudo!" : eu > ela ? "🏆 A sua é maior!" : eu === ela ? "🤝 Empate… e empate é da Hina!" : "😈 A da Hina é maior!"}`;
  } else if (jogo === "cofre") {
    const n = Number(escolha);
    if (!(Number.isInteger(n) && n >= 0 && n <= 9)) return c.responder(`Chute o último número da senha do cofre (0 a 9): *${c.prefixo}apostar cofre ${valor} 7*`);
    const alarme = chance(0.15);
    const senha = sorteio(0, 9);
    ganho = !alarme && senha === n ? valor * 10 : 0;
    texto = alarme ? `🔐 *COFRE* — 🚨 *O ALARME DISPAROU!* Você teve que fugir sem abrir.` : `🔐 *COFRE* — a senha terminava em *${senha}*… ${senha === n ? "🔓 *ABRIU!*" : "🔒 continua trancado."}`;
  } else if (["arremesso", "basquete", "cesta"].includes(jogo)) {
    const DIST = { curto: [0.425, 2], medio: [0.283, 3], "médio": [0.283, 3], longo: [0.17, 5] };
    if (!DIST[escolha]) return c.responder(`Escolha a distância: *curto* (2×), *medio* (3×) ou *longo* (5×): *${c.prefixo}apostar arremesso ${valor} medio*`);
    const [prob, mult] = DIST[escolha];
    const cesta = chance(prob);
    ganho = cesta ? Math.floor(valor * mult) : 0;
    texto = `🏀 Arremesso *${escolha.replace("é", "e")}*… ${cesta ? "🗑️ *CESTA!*" : ["bateu no aro! 😬", "passou longe! 🫣", "a bola ficou no aro e caiu pra fora! 😩"][sorteio(0, 2)]}`;
  } else if (["raspadinha", "raspa"].includes(jogo)) {
    const TAB = [["💎", 0.5, 50], ["🍀", 2, 10], ["⭐", 5.5, 4], ["🍒", 8, 2]];
    const sorteia = () => { let r = aleatorio() * 100; for (const [e, peso] of [["💎", 6], ["🍀", 12], ["⭐", 22], ["🍒", 30], ["❌", 30]]) { if ((r -= peso) < 0) return e; } return "❌"; };
    let casas;
    const r0 = aleatorio() * 100;
    let acum = 0, premio = null;
    for (const [e, chanceTrio, mult] of TAB) { acum += chanceTrio; if (r0 < acum) { premio = [e, mult]; break; } }
    if (premio) casas = [premio[0], premio[0], premio[0]];
    else { do { casas = [sorteia(), sorteia(), sorteia()]; } while (casas[0] !== "❌" && casas[0] === casas[1] && casas[1] === casas[2]); }
    ganho = premio ? valor * premio[1] : 0;
    texto = `🎟️ *RASPADINHA*\n| ${casas.join(" | ")} |${premio ? `\n🎉 Três ${premio[0]}! Paga *${premio[1]}×*` : ""}`;
  } else {
    const r = [giro(), giro(), giro()];
    const trio = r[0] === r[1] && r[1] === r[2];
    const par = !trio && (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]);
    ganho = trio ? valor * SLOT_TRIO[r[0]] : par ? Math.floor(valor * SLOT_PAR) : 0;
    texto = `🎰 | ${r.join(" | ")} |${trio && r[0] === "7️⃣" ? "\n💥 *JACKPOT!!!*" : ""}`;
  }
  ultimaAposta.set(k, Date.now());
  if (ultimaAposta.size > 2000) ultimaAposta.clear();
  m.carteira += ganho - valor;
  paraCaixa(c.jid, valor - ganho, "apostas", jogo, valor);
  m.apostado = (m.apostado || 0) + valor;
  m.ganhoApostas = (m.ganhoApostas || 0) + ganho;
  marcar(c.jid);
  const res = ganho > valor ? `🤑 Ganhou *${moedas(ganho)}* (lucro de ${moedas(ganho - valor)})!` : ganho > 0 ? `😅 Recuperou ${moedas(ganho)} de ${moedas(valor)}.` : `💸 Perdeu ${moedas(valor)}.`;
  return c.responder(`${texto}\n\n${res}\n👛 Na mão: ${moedas(m.carteira)}`);
});

def(["pausarapostas", "pararapostas"], G, async (c) => {
  if (!exigir(c)) return;
  const dias = Number(c.args[0]);
  const m = conta(c.jid, c.autorJid);
  if (!(dias >= 1 && dias <= 90 && Number.isInteger(dias))) {
    return c.responder(`⏸️ Use *${c.prefixo}pausarapostas 7* para bloquear as suas apostas por 7 dias (de 1 a 90).\nDepois de pausar, não dá para desfazer antes do prazo.${m.pausaApostasAte > Date.now() ? `\n\nPausa atual até ${new Date(m.pausaApostasAte).toLocaleDateString("pt-BR")}.` : ""}`);
  }
  m.pausaApostasAte = Math.max(m.pausaApostasAte || 0, Date.now() + dias * DIA);
  marcar(c.jid);
  return c.responder(`⏸️ Pronto: suas apostas estão pausadas em todos os grupos até *${new Date(m.pausaApostasAte).toLocaleDateString("pt-BR")}*. O resto do RPG continua normal.`);
});

const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const sinal = (v) => `${v >= 0 ? "🟢 +" : "🔴 "}${v.toFixed(1).replace(".", ",")}%`;
function resumoAtivo(t) {
  const b = passoBolsa();
  const h = b.historico[t] || [b.precos[t]];
  const agora = b.precos[t];
  const ant = h.length > 1 ? h[h.length - 2] : h[0];
  const horas = Math.max(1, Math.round(((h.length - 1) * PASSO_BOLSA) / HORA));
  return { t, a: ATIVOS[t], preco: agora, ultima: pct(agora, ant), dia: pct(agora, h[0]), periodo: `${horas}h`, min: Math.min(...h), max: Math.max(...h), h };
}
function rodapeBolsa() {
  const b = passoBolsa();
  const prox = Math.max(1, Math.ceil((b.atualizadoEm + PASSO_BOLSA - Date.now()) / MIN));
  return `🕒 Cotação de ${new Date(b.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · próxima em ${prox} min`;
}
function textoBolsa(p) {
  const b = passoBolsa();
  const todos = Object.keys(ATIVOS).map(resumoAtivo).sort((x, y) => y.ultima - x.ultima);
  const linha = (r) => `${r.a.emoji} *${r.t}* ${moedas(r.preco)} ${sinal(r.ultima)} _(${r.periodo} ${sinal(r.dia).slice(2).trim()})_\n   ${grafico(r.h)} risco *${r.a.risco}*`;
  const grupoDe = (titulo, lista) => (lista.length ? `${titulo}\n${lista.map(linha).join("\n")}\n\n` : "");
  const altas = todos.filter((r) => r.ultima > 0.5), quedas = todos.filter((r) => r.ultima < -0.5).reverse(), estaveis = todos.filter((r) => Math.abs(r.ultima) <= 0.5);
  const news = b.noticias.slice(-2).map((n) => `📰 ${n.texto}`).join("\n");
  return `📈 *BOLSA SORA*\n_⚠️ Cotações sobem e descem sozinhas: você pode perder moedas. Não há garantia de lucro._\n\n` +
    grupoDe("🚀 *EM ALTA*", altas) + grupoDe("📉 *EM QUEDA*", quedas) + grupoDe("➖ *ESTÁVEIS*", estaveis) +
    `${news ? `${news}\n\n` : ""}• *${p}investir SORA3 10* · *${p}venderacao SORA3 tudo*\n• *${p}minhasacoes* · *${p}historico SORA3* · *${p}comparar SORA3 HINA4*\n\n_Taxa de 1% em cada operação. ${rodapeBolsa()}_`;
}
const tickerDe = (x) => { const t = String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return ATIVOS[t] ? t : null; };

def(["historico", "historicoacao", "grafico"], G, async (c) => {
  if (!exigir(c, "bolsa")) return;
  const t = tickerDe(c.args[0]);
  if (!t) return c.responder(`Diga a ação: *${c.prefixo}historico SORA3*\nDisponíveis: ${Object.keys(ATIVOS).join(", ")}`);
  const r = resumoAtivo(t);
  const passo = Math.max(1, Math.floor(r.h.length / 12));
  const pontos = r.h.filter((_, i) => (r.h.length - 1 - i) % passo === 0).slice(-12);
  const horas = (r.h.length - 1) * PASSO_BOLSA / HORA;
  const linhas = pontos.map((v, i) => {
    const atras = Math.round((pontos.length - 1 - i) * passo * PASSO_BOLSA / MIN);
    return `${atras ? `há ${atras >= 60 ? `${Math.round(atras / 60)}h` : `${atras}min`}`.padEnd(8, " ") : "agora   "} ${moedas(v)}`;
  });
  const meu = conta(c.jid, c.autorJid).acoes[t];
  const medio = meu?.qtd ? meu.custo / meu.qtd : null;
  return c.responder(`${r.a.emoji} *${t}* — ${r.a.nome}\nRisco *${r.a.risco}*${r.a.div ? ` · paga ${(r.a.div * 100).toFixed(2).replace(".", ",")}% ao dia em dividendos` : ""}\n\n` +
    `💲 Agora: *${moedas(r.preco)}* ${sinal(r.ultima)}\n📅 Em ${horas >= 1 ? `${Math.round(horas)}h` : "pouco tempo"}: ${sinal(r.dia)}\n⬆️ Máxima: ${moedas(r.max)} · ⬇️ Mínima: ${moedas(r.min)}\n${grafico(r.h)}\n\n` +
    "```\n" + linhas.join("\n") + "\n```" +
    `${medio ? `\n📊 Seu preço médio: ${moedas(medio)} (${sinal(pct(r.preco, medio))})` : ""}\n\n_Histórico passado não garante resultado futuro. ${rodapeBolsa()}_`);
});

def(["comparar", "compararacoes"], G, async (c) => {
  if (!exigir(c, "bolsa")) return;
  const lista = [...new Set(c.args.map(tickerDe).filter(Boolean))].slice(0, 4);
  if (lista.length < 2) return c.responder(`Compare de 2 a 4 ações: *${c.prefixo}comparar SORA3 HINA4 NEKO11*`);
  const rs = lista.map(resumoAtivo);
  const melhor = (f) => rs.reduce((a, b) => (f(b) > f(a) ? b : a)).t;
  const blocos = rs.map((r) => `${r.a.emoji} *${r.t}* — ${r.a.nome}\n   💲 ${moedas(r.preco)} · última ${sinal(r.ultima)} · ${r.periodo} ${sinal(r.dia)}\n   ⬆️ ${moedas(r.max)} ⬇️ ${moedas(r.min)} · oscilação ${pct(r.max, r.min).toFixed(0)}%\n   ⚠️ risco *${r.a.risco}* · dividendos ${r.a.div ? `${(r.a.div * 100).toFixed(2).replace(".", ",")}%/dia` : "não"}\n   ${grafico(r.h)}`);
  return c.responder(`⚖️ *COMPARAÇÃO DE AÇÕES*\n\n${blocos.join("\n\n")}\n\n📈 Mais subiu no período: *${melhor((r) => r.dia)}*\n🌊 Mais oscilou: *${melhor((r) => pct(r.max, r.min))}*\n\n_Comparação do passado: não é recomendação e não garante lucro. ${rodapeBolsa()}_`);
});

def(["bolsa", "acoes", "ações", "mercado"], G, async (c) => {
  if (!exigir(c, "bolsa")) return;
  const sub = String(c.args[0] || "").toLowerCase();
  if (sub === "comprar") { c.args = c.args.slice(1); return C.find((x) => x.nomes[0] === "investir").run(c); }
  if (sub === "vender") { c.args = c.args.slice(1); return C.find((x) => x.nomes[0] === "venderacao").run(c); }
  return c.responder(textoBolsa(c.prefixo));
});
function operacao(c, comprar) {
  const t = String(c.args[0] || "").toUpperCase();
  if (!ATIVOS[t]) return c.responder(`Ação não encontrada. Veja as disponíveis em *${c.prefixo}bolsa*.`);
  const m = conta(c.jid, c.autorJid);
  const preco = precoAcao(t);
  const pos = m.acoes[t] || { qtd: 0, custo: 0 };
  const max = comprar ? Math.floor(m.carteira / (preco * (1 + TAXA_BOLSA))) : pos.qtd;
  const qtd = lerValor(c.args[1] || "1", max);
  if (!(qtd > 0)) return c.responder(`Diga a quantidade: *${c.prefixo}${comprar ? "investir" : "venderacao"} ${t} 10*${comprar ? "" : " (ou *tudo*)"}`);
  if (qtd > max) return c.responder(comprar ? `Com ${moedas(m.carteira)} na mão dá para comprar no máximo *${fmt(max)}* ${t}.` : `Você só tem *${fmt(pos.qtd)}* ${t}.`);
  const bruto = qtd * preco;
  const taxa = Math.ceil(bruto * TAXA_BOLSA);
  if (comprar) {
    m.carteira -= Math.ceil(bruto) + taxa;
    pos.custo += bruto; pos.qtd += qtd;
    pos.divEm ||= Date.now();
    m.acoes[t] = pos;
  } else {
    const custoMedio = pos.qtd ? pos.custo / pos.qtd : 0;
    pos.custo -= custoMedio * qtd; pos.qtd -= qtd;
    m.carteira += Math.floor(bruto) - taxa;
    if (!pos.qtd) delete m.acoes[t];
    const lucro = Math.floor(bruto - taxa - custoMedio * qtd);
    marcar(c.jid);
    return c.responder(`📤 Vendeu *${fmt(qtd)} ${t}* a ${moedas(preco)}: +${moedas(Math.floor(bruto) - taxa)} (taxa ${fmt(taxa)})\n${lucro >= 0 ? "🟢 Lucro" : "🔴 Prejuízo"}: ${moedas(Math.abs(lucro))}\n👛 Na mão: ${moedas(m.carteira)}`);
  }
  marcar(c.jid);
  return c.responder(`📥 Comprou *${fmt(qtd)} ${t}* a ${moedas(preco)}: −${moedas(Math.ceil(bruto) + taxa)} (taxa ${fmt(taxa)})\n📊 Agora você tem ${fmt(pos.qtd)} ${t}.\n👛 Na mão: ${moedas(m.carteira)}`);
}
def(["investir", "compraracao"], G, async (c) => { if (!exigir(c, "bolsa") || !exigirTermos(c, conta(c.jid, c.autorJid))) return; return operacao(c, true); });
def(["venderacao", "vendeacao", "desinvestir"], G, async (c) => { if (!exigir(c, "bolsa")) return; return operacao(c, false); });
def(["minhasacoes", "carteiraacoes", "minhasações"], G, async (c) => {
  if (!exigir(c, "bolsa")) return;
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const lista = Object.entries(m.acoes).filter(([, a]) => a?.qtd > 0);
  if (!lista.length) return c.responder(`${mesmaPessoa(c, alvo, c.autorJid) ? "Você ainda não tem" : `${marca(alvo)} não tem`} ações. Veja a *${c.prefixo}ações* e use *${c.prefixo}investir SORA3 10*.`, [alvo]);
  let total = 0, custo = 0;
  const linhas = lista.sort((x, y) => y[1].qtd * precoAcao(y[0]) - x[1].qtd * precoAcao(x[0])).map(([t, a]) => {
    const r = resumoAtivo(t);
    const v = a.qtd * r.preco; total += v; custo += a.custo;
    const medio = a.custo / a.qtd;
    const res = v - a.custo;
    return `${ATIVOS[t]?.emoji || "•"} *${t}* × ${fmt(a.qtd)}\n   Compra (média): ${moedas(medio)} → agora ${moedas(r.preco)} ${sinal(pct(r.preco, medio))}\n   Valor: ${moedas(v)} · ${Math.abs(res) < 1 ? "➖ sem variação" : `${res > 0 ? "🟢 lucro" : "🔴 prejuízo"} de ${moedas(Math.abs(res))}`}\n   ${grafico(r.h)} última ${sinal(r.ultima)}`;
  });
  const res = total - custo;
  return c.responder(`📊 *CARTEIRA DE AÇÕES* — ${marca(alvo)}\n\n${linhas.join("\n\n")}\n\n💼 Investido: ${moedas(custo)} · Vale hoje: *${moedas(total)}*\n${Math.abs(res) < 1 ? "➖ Sem variação até agora" : `${res > 0 ? "🟢 Lucro" : "🔴 Prejuízo"} total: *${moedas(Math.abs(res))}* (${sinal(pct(total, custo))})`}\n💸 Dividendos recebidos: ${moedas(m.divRecebidos || 0)}\n\n_Lucro ou prejuízo ainda não realizado: muda com a cotação. Vender cobra 1% de taxa._`, [alvo]);
});

def(["loja", "propriedades", "imoveis"], G, async (c) => {
  if (!exigir(c, "loja")) return;
  const [sub, nomeItem, q] = [String(c.args[0] || "").toLowerCase(), String(c.args[1] || "").toLowerCase(), c.args[2]];
  const m = conta(c.jid, c.autorJid);
  if (sub === "comprar" || sub === "vender") {
    const it = ITENS[nomeItem];
    if (!it || (it.off && sub === "comprar")) return c.responder(`Item não encontrado. Opções: ${Object.keys(ITENS).filter((k) => !ITENS[k].premium && !ITENS[k].off).map((k) => `*${k}*`).join(", ")}.`);
    if (it.premium) return c.responder(sub === "comprar" ? `⭐ *${it.nome}* é premium: compra no Pix com *${c.prefixo}premium comprar ${nomeItem}*.` : `⭐ Propriedade premium não pode ser vendida por moedas: ela é sua para sempre e nunca dá prejuízo.`);
    const tem = m.itens[nomeItem] || 0;
    const qtd = Math.max(1, Math.floor(Number(q) || 1));
    const { valor: renda } = rendaPendente(m);
    if (sub === "comprar") {
      const lim = maxDe(nomeItem);
      if (tem + qtd > lim) return c.responder(lim === 1
        ? `📏 Você já tem ${it.emoji} *${it.nome}*. Cada propriedade pode ser comprada só uma vez. Venda para comprar novamente.`
        : `📏 Dá para ter no máximo *${lim}× ${it.nome}* (você tem ${tem}).`);
      if (it.preco * qtd > m.carteira) return c.responder(`${it.emoji} ${qtd}× ${it.nome} custa ${moedas(it.preco * qtd)}. Você tem ${moedas(m.carteira)} na mão.`);
      m.carteira += renda - it.preco * qtd; m.ultimaColeta = Date.now();
      m.itens[nomeItem] = tem + qtd;
      marcar(c.jid);
      return c.responder(`🎉 Comprou ${qtd > 1 ? `${qtd}× ` : ""}${it.emoji} *${it.nome}* por ${moedas(it.preco * qtd)}!\nRende ${moedas(it.renda * qtd)}/h (muda conforme o mercado) — colete com *${c.prefixo}coletar*.${renda ? `\n_(Renda pendente de ${moedas(renda)} já foi coletada.)_` : ""}`);
    }
    if (qtd > tem) return c.responder(`Você tem ${tem}× ${it.nome}.`);
    const valor = Math.floor(it.preco * VENDA()) * qtd;
    m.carteira += renda + valor; m.ultimaColeta = Date.now();
    m.itens[nomeItem] = tem - qtd;
    if (!m.itens[nomeItem]) delete m.itens[nomeItem];
    marcar(c.jid);
    return c.responder(`🤝 Vendeu ${qtd}× ${it.emoji} *${it.nome}* por ${moedas(valor)} (${Math.round(VENDA() * 100)}% do preço).`);
  }
  const merc = atualizarMercado();
  const ev = merc.evento;
  const linhaEvento = ev?.cat ? `\n${ev.emoji} *${ev.nome}* hoje — ${ev.fator >= 1 ? "🟢 alta" : "🔴 baixa"} no setor de *${ev.cat}*.` : "\n📊 Mercado estável hoje.";
  const linhas = Object.entries(ITENS).filter(([, it]) => !it.premium && !it.off).map(([k, it]) => {
    const rendaHoje = Math.floor(it.renda * (merc.fatores?.[k] ?? 1));
    const diff = rendaHoje - it.renda;
    const sinalRenda = diff > 0 ? ` 🟢 +${fmt(diff)}` : diff < 0 ? ` 🔴 −${fmt(-diff)}` : "";
    const tem = m.itens[k] || 0;
    const posse = !tem ? "" : maxDe(k) > 1 ? ` · ✅ ${tem}/${maxDe(k)}` : " · ✅ sua";
    return `${k === "academia" ? "\n💼 *NEGÓCIOS* — até 2 de cada, se pagam em ~6 dias\n" : ""}${k === "hotel" ? "\n💎 *LUXO* — até 2 de cada\n" : ""}${it.emoji} *${it.nome}* (${k})\n   ${moedas(it.preco)} · hoje rende ${moedas(rendaHoje)}/h${sinalRenda}${posse}`;
  });
  const { valor, porHora } = rendaPendente(m);
  return c.responder(`🏘️ *LOJA DE PROPRIEDADES*${linhaEvento}\n\n${linhas.join("\n")}\n\n• *${c.prefixo}loja comprar fazenda*\n• *${c.prefixo}loja vender fazenda* (devolve ${Math.round(VENDA() * 100)}%)\n• *${c.prefixo}coletar* — recebe a renda (acumula até ${CFG_JOGO().acumulaHoras} h)${CFG_JOGO().premium ? `\n⭐ *Premium/VIP* — rendem muito mais, renda fixa e nunca dão prejuízo: *${c.prefixo}premium*` : ""}\n_Comuns: ${CFG_JOGO().maxComum} de cada · Negócios e Luxo: até 2 de cada (${c.prefixo}loja comprar hotel 2). A renda muda todo dia._\n\n${porHora ? `💰 Sua renda hoje: ${moedas(porHora)}/h · para coletar: ${moedas(valor)}` : "_Você ainda não tem propriedades._"}`);
});
const ACHADOS = {
  chiclete: { nome: "Chiclete mascado", emoji: "🍬", valor: 300 },
  meia: { nome: "Meia furada", emoji: "🧦", valor: 800 },
  relogio: { nome: "Relógio quebrado", emoji: "⌚", valor: 2_000 },
  oculos: { nome: "Óculos escuros", emoji: "🕶️", valor: 4_500 },
  tenis: { nome: "Tênis usado", emoji: "👟", valor: 7_000 },
  fone: { nome: "Fone bluetooth", emoji: "🎧", valor: 12_000 },
  skate: { nome: "Skate", emoji: "🛹", valor: 18_000 },
  celular: { nome: "Celular antigo", emoji: "📱", valor: 25_000 },
  videogame: { nome: "Videogame retrô", emoji: "🎮", valor: 40_000 },
  bicicleta: { nome: "Bicicleta", emoji: "🚲", valor: 60_000 },
  guitarra: { nome: "Guitarra", emoji: "🎸", valor: 90_000 },
  notebook: { nome: "Notebook", emoji: "💻", valor: 140_000 },
  moto: { nome: "Moto usada", emoji: "🏍️", valor: 220_000 },
  joia: { nome: "Joia de ouro", emoji: "💍", valor: 320_000 },
  carro: { nome: "Carro popular", emoji: "🚗", valor: 450_000 },
  quadro: { nome: "Quadro raro", emoji: "🖼️", valor: 700_000 },
};
const CAIXAS = {
  caixote: { nome: "Caixote", emoji: "📦", preco: 10_000, inic: true, itens: { chiclete: 14, meia: 14, relogio: 15, oculos: 15, tenis: 13, fone: 12, skate: 9, celular: 5, videogame: 2.2, bicicleta: 0.8 } },
  madeira: { nome: "Baú de Madeira", emoji: "🪵", preco: 35_000, inic: true, itens: { relogio: 7, oculos: 9, tenis: 12, fone: 14, skate: 15, celular: 14, videogame: 12, bicicleta: 8, guitarra: 5, notebook: 2.2, moto: 0.8 } },
  ferro: { nome: "Baú de Ferro", emoji: "⚙️", preco: 80_000, inic: true, itens: { tenis: 6, fone: 10, skate: 12, celular: 14, videogame: 15, bicicleta: 14, guitarra: 12, notebook: 9, moto: 5, joia: 2.2, carro: 0.8 } },
  prata: { nome: "Baú de Prata", emoji: "🥈", preco: 190_000, inic: true, itens: { skate: 5, celular: 9, videogame: 12, bicicleta: 14, guitarra: 15, notebook: 15, moto: 12, joia: 9, carro: 6, quadro: 3 } },
  comum: { nome: "Caixa Comum", emoji: "🟢", preco: 400_000, faixa: [300_000, 1_500_000], pesos: { pouco: 36, medio: 27, muito: 8, prop: 20, brinde: 9, premium: 0 } },
  rara: { nome: "Caixa Rara", emoji: "🔵", preco: 900_000, faixa: [650_000, 3_000_000], pesos: { pouco: 35, medio: 27, muito: 8, prop: 22, brinde: 8, premium: 0.05 } },
  epica: { nome: "Caixa Épica", emoji: "🟣", preco: 1_800_000, faixa: [1_500_000, 6_000_000], pesos: { pouco: 34, medio: 27, muito: 9, prop: 23, brinde: 7, premium: 0.15 } },
  lendaria: { nome: "Caixa Lendária", emoji: "🟡", preco: 3_000_000, faixa: [3_000_000, 10_000_000], pesos: { pouco: 34, medio: 27, muito: 9, prop: 24, brinde: 6, premium: 0.4 } },
};
const APELIDO_CAIXA = { bau: "madeira", baú: "madeira", "baúdemadeira": "madeira", caixa: "caixote", verde: "comum", azul: "rara", roxa: "epica", épica: "epica", dourada: "lendaria", lendária: "lendaria", lenda: "lendaria" };
const MULT_CAIXA = { pouco: [0.15, 0.55], medio: [0.7, 1.3], muito: [1.6, 3.5] };
const PESO_PREMIUM = { quiosque: 60, supermercado: 25, mansao: 10, jatinho: 4, ilha: 1, bancosora: 0.3 };
const ultimaCaixa = new Map();
const pctCaixa = (p, total) => `${(p / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: p / total < 0.01 ? 2 : 0 })}%`;

function sortearPeso(pesos) {
  const tot = Object.values(pesos).reduce((s, v) => s + v, 0);
  let r = aleatorio() * tot;
  for (const [k, v] of Object.entries(pesos)) { if ((r -= v) < 0) return k; }
  return Object.keys(pesos)[0];
}

function abrirUmaCaixa(m, cx) {
  if (cx.itens) {
    const k = sortearPeso(cx.itens), it = ACHADOS[k];
    m.achados ||= {}; m.achados[k] = (m.achados[k] || 0) + 1;
    const tag = it.valor >= cx.preco * 2 ? "💰" : it.valor >= cx.preco ? "📈" : "📉";
    return { linha: `${tag} ${it.emoji} *${it.nome}* (vende por ${moedas(it.valor)})`, valor: it.valor, achado: true };
  }
  const tipo = sortearPeso(cx.pesos);
  if (MULT_CAIXA[tipo]) {
    const [a, b] = MULT_CAIXA[tipo];
    const v = Math.round(cx.preco * (a + aleatorio() * (b - a)) / 100) * 100;
    m.carteira += v;
    const tag = tipo === "muito" ? "💰 *JACKPOT!*" : tipo === "medio" ? "💵" : "🪫";
    return { linha: `${tag} ${moedas(v)}`, valor: v };
  }
  if (tipo === "premium") {
    const opcoes = premiumAtivas().filter(([k]) => (m.itens[k] || 0) < maxDe(k));
    if (opcoes.length) {
      const pesos = Object.fromEntries(opcoes.map(([k]) => [k, PESO_PREMIUM[k] ?? 1]));
      const k = sortearPeso(pesos), it = ITENS[k];
      m.itens[k] = (m.itens[k] || 0) + 1;
      return { linha: `🌟🌟🌟 *PREMIUM!!!* ${it.emoji} *${it.nome}* (rende ${moedas(it.renda)}/h fixo, para sempre)`, valor: it.preco, premium: true };
    }
    const v = cx.preco * 5; m.carteira += v;
    return { linha: `🌟 Premium repetida, virou ${moedas(v)}!`, valor: v };
  }
  if (tipo === "prop") {
    const pool = Object.entries(ITENS).filter(([, it]) => !it.premium && !it.off && it.preco >= cx.faixa[0] && it.preco <= cx.faixa[1]);
    const [k, it] = pool[Math.floor(aleatorio() * pool.length)];
    const venda = Math.floor(it.preco * VENDA());
    if ((m.itens[k] || 0) >= maxDe(k)) {
      m.carteira += venda;
      return { linha: `🏠 ${it.emoji} *${it.nome}* (repetida, vendida por ${moedas(venda)})`, valor: venda };
    }
    m.itens[k] = (m.itens[k] || 0) + 1;
    return { linha: `🏠 ${it.emoji} *${it.nome}* (vale ${moedas(it.preco)} · vende por ${moedas(venda)})`, valor: venda };
  }
  const k = cosmeticos(m);
  const opc = [
    ...Object.entries(MOLDURAS).filter(([id, x]) => x.preco > 0 && !x.vip && !k.molduras.includes(id)).map(([id, x]) => ["moldura", id, x]),
    ...Object.entries(TITULOS).filter(([id, x]) => x.preco > 0 && !x.vip && !k.titulos.includes(id)).map(([id, x]) => ["titulo", id, x]),
  ];
  if (opc.length) {
    const [qual, id, x] = opc[Math.floor(aleatorio() * opc.length)];
    (qual === "moldura" ? k.molduras : k.titulos).push(id);
    return { linha: `🎀 Brinde: ${qual === "moldura" ? "moldura" : "título"} *${x.nome}*`, valor: x.preco };
  }
  const v = Math.round(cx.preco * 0.15); m.carteira += v;
  return { linha: `🎀 Brinde: ${moedas(v)} (você já tem todos os cosméticos)`, valor: v };
}

def(["caixas", "caixamisteriosa", "abrircaixa", "lootbox"], G, async (c) => {
  if (!exigir(c, "apostas")) return;
  const m = conta(c.jid, c.autorJid);
  let [a0, a1, a2] = c.args.map((x) => String(x || "").toLowerCase());
  if (c.cmd === "abrircaixa") [a0, a1, a2] = ["abrir", a0, a1];
  const id = APELIDO_CAIXA[a1] || a1;
  if (["itens", "achados", "ver"].includes(a0)) {
    const l = Object.entries(m.achados || {}).filter(([, q]) => q > 0).sort((x, y) => ACHADOS[y[0]].valor - ACHADOS[x[0]].valor);
    if (!l.length) return c.responder(`📦 Você não tem itens das caixas. Abra um *${c.prefixo}caixas abrir caixote*!`);
    const tot = l.reduce((s, [k, q]) => s + ACHADOS[k].valor * q, 0);
    return c.responder(`🧺 *SEUS ACHADOS*\n\n${l.map(([k, q]) => `${ACHADOS[k].emoji} *${ACHADOS[k].nome}* (${k}) ×${q} · ${moedas(ACHADOS[k].valor * q)}`).join("\n")}\n\n💰 Vale tudo: *${moedas(tot)}*\n_${c.prefixo}caixas vender tudo · ${c.prefixo}caixas vender skate_`);
  }
  if (a0 === "vender") {
    const tudo = !a1 || a1 === "tudo";
    const l = Object.entries(m.achados || {}).filter(([k, q]) => q > 0 && (tudo || k === a1));
    if (!l.length) return c.responder(tudo ? "🧺 Nada para vender." : `Você não tem *${a1}*. Veja em *${c.prefixo}caixas itens*.`);
    let total = 0, qtd = 0;
    for (const [k, q] of l) { total += ACHADOS[k].valor * q; qtd += q; delete m.achados[k]; }
    m.carteira += total; anotar(m, "achados", total); marcar(c.jid);
    return c.responder(`🤝 Vendeu ${qtd} item(ns) por *${moedas(total)}*.\n💵 Na mão: ${moedas(m.carteira)}`);
  }
  if (a0 !== "abrir" || !CAIXAS[id]) {
    const inic = Object.entries(CAIXAS).filter(([, cx]) => cx.inic).map(([k, cx]) => {
      const vals = Object.keys(cx.itens).map((i) => ACHADOS[i].valor);
      return `${cx.emoji} *${cx.nome}* (${k}) · ${moedas(cx.preco)}\n   itens de ${moedas(Math.min(...vals))} a ${moedas(Math.max(...vals))}`;
    });
    const blocos = Object.entries(CAIXAS).filter(([, cx]) => !cx.inic).map(([k, cx]) => {
      const tot = Object.values(cx.pesos).reduce((s, v) => s + v, 0), p = cx.pesos;
      return `${cx.emoji} *${cx.nome}* (${k}) · ${moedas(cx.preco)}\n   🪙 moedas ${pctCaixa(p.pouco + p.medio + p.muito, tot)} · 🏠 propriedade ${pctCaixa(p.prop, tot)} · 🎀 brinde ${pctCaixa(p.brinde, tot)}${p.premium ? ` · 🌟 premium ${pctCaixa(p.premium, tot)}` : ""}`;
    });
    return c.responder(`🎁 *CAIXAS MISTERIOSAS*\nAbra e torça: pode vir moeda, propriedade pra vender com lucro, brinde ou, se a sorte deixar, uma propriedade ⭐ *PREMIUM*.\n\n🧰 *PRA QUEM ESTÁ COMEÇANDO* (itens simples pra vender)\n${inic.join("\n")}\n\n💎 *CAIXAS GRANDES*\n${blocos.join("\n\n")}\n\n• *${c.prefixo}caixas abrir caixote* (ou madeira, ferro, prata, comum, rara, epica, lendaria)\n• *${c.prefixo}caixas abrir rara 3* — abre até 5 de uma vez\n• *${c.prefixo}caixas itens* — seus achados · *${c.prefixo}caixas vender tudo*\n• Propriedade repetida é vendida sozinha · venda as outras com *${c.prefixo}loja vender*\n\n_⚠️ É sorte: dá pra lucrar, mas também dá pra perder. Na média volta menos do que custa._`);
  }
  if (!exigirTermos(c, m)) return;
  if (m.pausaApostasAte > Date.now()) return c.responder("⏸️ Suas apostas estão pausadas (caixas também contam), como você pediu.");
  const k = `${c.jid}|${usuario(c.autorJid)}`;
  if (Date.now() - (ultimaCaixa.get(k) || 0) < 15_000) return c.responder("⏳ Calma! Espere uns segundinhos para abrir outra caixa.");
  const cx = CAIXAS[id];
  const qtd = Math.min(5, Math.max(1, Math.floor(Number(a2) || 1)));
  const custo = cx.preco * qtd;
  if (custo > m.carteira) return c.responder(`${cx.emoji} ${qtd > 1 ? `${qtd}× ` : ""}${cx.nome} custa ${moedas(custo)}. Você tem ${moedas(m.carteira)} na mão.`);
  ultimaCaixa.set(k, Date.now());
  const { valor: pendente } = rendaPendente(m);
  m.carteira += pendente; m.ultimaColeta = Date.now();
  m.carteira -= custo;
  const res = Array.from({ length: qtd }, () => abrirUmaCaixa(m, cx));
  const total = res.reduce((s, r) => s + r.valor, 0);
  anotar(m, "caixa", total - custo);
  marcar(c.jid);
  const saldo = total - custo;
  const veredito = res.some((r) => r.premium) ? "🌟 *QUE SORTE ABSURDA!* Saiu uma PREMIUM!"
    : saldo > 0 ? `📈 Lucro estimado: *+${moedas(saldo)}*` : `📉 Prejuízo estimado: *−${moedas(-saldo)}*`;
  return c.responder(`🎁 *${cx.emoji} ${cx.nome.toUpperCase()}${qtd > 1 ? ` ×${qtd}` : ""}*\n_Abrindo… 🥁_\n\n${res.map((r, i) => `${qtd > 1 ? `${i + 1}. ` : ""}${r.linha}`).join("\n")}\n\n${veredito}\n💵 Na mão: ${moedas(m.carteira)}${res.some((r) => r.achado) ? `\n_Venda com *${c.prefixo}caixas vender tudo* (ou guarde e venda depois)._` : res.some((r) => r.linha.includes("vende por")) ? `\n_Venda com *${c.prefixo}loja vender (nome)* ou fique com ela rendendo._` : ""}`);
});

def(["coletar", "renda"], G, async (c) => {
  if (!exigir(c, "loja")) return;
  const m = conta(c.jid, c.autorJid);
  const { valor, porHora, bonusPct } = rendaPendente(m);
  if (!porHora) return c.responder(`Você não tem propriedades. Veja a *${c.prefixo}loja*.`);
  if (valor < 1) return c.responder("⏳ Ainda não rendeu nada desde a última coleta.");
  m.carteira += valor; m.ultimaColeta = Date.now();
  marcar(c.jid);
  const ev = mercado().evento;
  const linhaEvento = ev?.cat ? `\n${ev.emoji} *${ev.nome}* hoje (afeta ${ev.cat}).` : "";
  const linhaBonus = bonusPct >= 1 ? ` _(+${bonusPct}% de bônus!)_` : bonusPct <= -1 ? ` _(${bonusPct}% hoje)_` : "";
  return c.responder(`💰 ${marca(c.autorJid)} coletou *${moedas(valor)}* das propriedades.${linhaBonus}${linhaEvento}`, [c.autorJid]);
});

def(["poupanca", "poupança"], G, async (c) => {
  if (!exigir(c, "investir")) return;
  const m = conta(c.jid, c.autorJid);
  m.poupanca ||= { valor: 0, em: Date.now(), juros: 0 };
  const [acao, qtd] = [String(c.args[0] || "").toLowerCase(), c.args[1]];
  if (!["depositar", "dep", "sacar", "saque"].includes(acao)) {
    return c.responder(`🐷 *POUPANÇA*\n\n💰 Guardado: *${moedas(m.poupanca.valor)}*\n📈 Já rendeu: ${moedas(m.poupanca.juros || 0)}\n\n` +
      `Rende *0,5% ao dia* (sobre até ${moedas(POUPANCA_TETO)}), sem risco e sem prazo.\n• *${c.prefixo}poupanca depositar 1000*\n• *${c.prefixo}poupanca sacar tudo*`);
  }
  const depositar = acao.startsWith("dep");
  const valor = lerValor(qtd, depositar ? m.carteira : m.poupanca.valor);
  if (!(valor > 0)) return c.responder(`Diga o valor: *${c.prefixo}poupanca ${depositar ? "depositar" : "sacar"} 1000* (ou *tudo*).`);
  if (depositar ? valor > m.carteira : valor > m.poupanca.valor) return c.responder(`Você não tem ${moedas(valor)} ${depositar ? "na mão" : "na poupança"}.`);
  if (depositar) { m.carteira -= valor; m.poupanca.valor += valor; if (m.poupanca.valor === valor) m.poupanca.em = Date.now(); }
  else { m.poupanca.valor -= valor; m.carteira += valor; }
  marcar(c.jid);
  return c.responder(`🐷 ${depositar ? "Guardou" : "Sacou"} *${moedas(valor)}*.\n💰 Poupança: ${moedas(m.poupanca.valor)} · 👛 Na mão: ${moedas(m.carteira)}`);
});

def(["cdb", "rendafixa"], G, async (c) => {
  if (!exigir(c, "investir")) return;
  const m = conta(c.jid, c.autorJid);
  m.cdbs ||= [];
  const acao = String(c.args[0] || "").toLowerCase();
  const lista = () => m.cdbs.map((x, i) => {
    const pronto = Date.now() >= x.vence;
    return `${i + 1}. ${moedas(x.valor)} · ${x.dias} dias · +${Math.round(x.taxa * 100)}% → ${pronto ? "✅ *pronto para resgatar*" : `vence ${new Date(x.vence).toLocaleDateString("pt-BR")}`}`;
  }).join("\n");
  if (acao === "aplicar") {
    const dias = Number(c.args[2]);
    if (!PRAZOS_CDB[dias]) return c.responder(`Escolha o prazo: *${c.prefixo}cdb aplicar 5000 7*, *15* ou *30* dias.`);
    const valor = lerValor(c.args[1], m.carteira);
    if (!(valor >= 500)) return c.responder(`Aplicação mínima: ${moedas(500)}.`);
    if (valor > m.carteira) return c.responder(`Você só tem ${moedas(m.carteira)} na mão.`);
    if (m.cdbs.length >= MAX_CDB) return c.responder(`📏 Máximo de ${MAX_CDB} CDBs ao mesmo tempo. Resgate um antes.`);
    m.carteira -= valor;
    m.cdbs.push({ valor, dias, taxa: PRAZOS_CDB[dias], inicio: Date.now(), vence: Date.now() + dias * DIA });
    marcar(c.jid);
    return c.responder(`🏛️ Aplicou *${moedas(valor)}* por ${dias} dias. No vencimento você resgata *${moedas(Math.floor(valor * (1 + PRAZOS_CDB[dias])))}*.\n_Resgatar antes do prazo devolve 98% e sem juros._`);
  }
  if (acao === "resgatar") {
    const i = Number(c.args[1]) - 1;
    const x = m.cdbs[i];
    if (!x) return c.responder(m.cdbs.length ? `Qual CDB? Use o número da lista:\n${lista()}` : "Você não tem CDB aplicado.");
    const pronto = Date.now() >= x.vence;
    const valor = pronto ? Math.floor(x.valor * (1 + x.taxa)) : Math.floor(x.valor * (1 - MULTA_CDB));
    m.cdbs.splice(i, 1);
    m.carteira += valor;
    if (!pronto) paraCaixa(c.jid, x.valor - valor, "cdb");
    marcar(c.jid);
    return c.responder(pronto ? `✅ CDB resgatado: *${moedas(valor)}* (lucro de ${moedas(valor - x.valor)}).` : `⚠️ Resgate antecipado: recebeu ${moedas(valor)} (multa de ${moedas(x.valor - valor)}, sem juros).`);
  }
  const taxas = Object.entries(PRAZOS_CDB).map(([d, t]) => `• ${d} dias: +${Math.round(t * 100)}%`).join("\n");
  return c.responder(`🏛️ *CDB — RENDA FIXA*\n\nGanho garantido no vencimento:\n${taxas}\n\n• *${c.prefixo}cdb aplicar 5000 15*\n• *${c.prefixo}cdb resgatar 1*\n\n${m.cdbs.length ? `📄 Seus CDBs:\n${lista()}` : "_Você não tem CDB aplicado._"}`);
});

def(["dividendos"], G, async (c) => {
  if (!exigir(c, "investir")) return;
  const m = conta(c.jid, c.autorJid);
  const linhas = Object.entries(ATIVOS).filter(([, a]) => a.div).map(([t, a]) => {
    const q = m.acoes[t]?.qtd || 0;
    return `${a.emoji} *${t}* paga ${(a.div * 100).toFixed(2).replace(".", ",")}% ao dia${q ? ` · você tem ${fmt(q)} (≈ ${moedas(q * precoAcao(t) * a.div)}/dia)` : ""}`;
  });
  return c.responder(`💸 *DIVIDENDOS*\n\n${linhas.join("\n")}\n\nCaem sozinhos na carteira, proporcionais ao tempo que você fica com a ação.\n💰 Já recebeu: ${moedas(m.divRecebidos || 0)}\n_Comprar: ${c.prefixo}investir NEKO11 10_`);
});

def(["investimentos", "meusinvestimentos"], G, async (c) => {
  if (!exigir(c)) return;
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  let acoes = 0;
  for (const [t, a] of Object.entries(m.acoes)) acoes += (a?.qtd || 0) * precoAcao(t);
  const cdb = (m.cdbs || []).reduce((s, x) => s + x.valor, 0);
  return c.responder(`💼 *INVESTIMENTOS* — ${marca(alvo)}\n\n🐷 Poupança: ${moedas(m.poupanca?.valor || 0)}\n🏛️ CDB: ${moedas(cdb)} (${(m.cdbs || []).length} aplicação/ões)\n📈 Ações: ${moedas(acoes)}\n💸 Dividendos recebidos: ${moedas(m.divRecebidos || 0)}\n\n💎 Total investido: *${moedas((m.poupanca?.valor || 0) + cdb + acoes)}*`, [alvo]);
});

const DONO_G = { grupo: true, dono: true };
const EQUIPE_G = { grupo: true, equipe: true };
function logAdmin(c, acao, alvo, valor = null, extra = null) {
  const d = dados(c.jid);
  d.logAdmin ||= [];
  d.logAdmin.push({ t: Date.now(), acao, por: chave(c.jid, c.autorJid), alvo: alvo ? chave(c.jid, alvo) : null, ...(valor != null ? { valor } : {}), ...(extra ? { extra: String(extra).slice(0, 80) } : {}) });
  if (d.logAdmin.length > 100) d.logAdmin.splice(0, d.logAdmin.length - 100);
  marcar(c.jid);
}
function pedidoAdmin(c) {
  const alvo = alvoMarcado(c);
  const resto = valoresDe(c);
  const noBanco = resto.some((x) => x.toLowerCase() === "banco");
  const termos = resto.filter((x) => x.toLowerCase() !== "banco");
  return { alvo, noBanco, valorTxt: termos[0], motivo: termos.slice(1).join(" ").slice(0, 80) || null };
}
const usoAdmin = (c, cmd, ex = "1000") => c.responder(`Use: *${c.prefixo}${cmd} @fulano ${ex}* (ou responda a mensagem da pessoa com *${c.prefixo}${cmd} ${ex}*)\nAcrescente *banco* para mexer no banco em vez da carteira.`);

def(["addmoeda", "addmoedas", "darmoeda"], DONO_G, async (c) => {
  const { alvo, noBanco, valorTxt, motivo } = pedidoAdmin(c);
  const valor = lerValor(valorTxt, 0);
  if (!alvo || !(valor > 0)) return usoAdmin(c, "addmoeda");
  const m = conta(c.jid, alvo);
  if ((noBanco ? m.banco : m.carteira) + valor > LIMITE) return c.responder(`Esse valor passaria do teto de segurança do saldo (${moedas(LIMITE)}).`);
  if (noBanco) m.banco += valor; else m.carteira += valor;
  logAdmin(c, "addmoeda", alvo, valor, motivo);
  marcar(c.jid);
  return c.responder(`➕ *${moedas(valor)}* adicionadas ${noBanco ? "no banco" : "na carteira"} de ${marca(alvo)}.${motivo ? `\n📝 ${motivo}` : ""}\n👛 Na mão: ${moedas(m.carteira)} · 🏦 Banco: ${moedas(m.banco)}`, [alvo]);
});

def(["rmvmoeda", "rmvmoedas", "removermoeda", "tirarmoeda"], DONO_G, async (c) => {
  const { alvo, noBanco, valorTxt, motivo } = pedidoAdmin(c);
  if (!alvo) return usoAdmin(c, "rmvmoeda");
  const m = conta(c.jid, alvo);
  const disponivel = noBanco ? m.banco : m.carteira;
  const pedido = lerValor(valorTxt, disponivel);
  if (!(pedido > 0)) return usoAdmin(c, "rmvmoeda", "1000 (ou tudo)");
  const valor = Math.min(pedido, disponivel);
  if (noBanco) m.banco -= valor; else m.carteira -= valor;
  logAdmin(c, "rmvmoeda", alvo, valor, motivo);
  marcar(c.jid);
  return c.responder(`➖ *${moedas(valor)}* removidas ${noBanco ? "do banco" : "da carteira"} de ${marca(alvo)}.${valor < pedido ? `\n_(Só tinha ${moedas(valor)}; o saldo nunca fica negativo.)_` : ""}${motivo ? `\n📝 ${motivo}` : ""}\n👛 Na mão: ${moedas(m.carteira)} · 🏦 Banco: ${moedas(m.banco)}`, [alvo]);
});

function estornoNivel(jid, aplicar, por) {
  const d = dados(jid);
  const r = { pessoas: [], total: 0, tirado: 0, parciais: 0 };
  for (const [k, m] of Object.entries(d.membros)) {
    const premios = (m.hist || []).filter((h) => h.tipo === "prêmio" && h.v > 0 && !h.estornado);
    const ganho = premios.reduce((s, h) => s + h.v, 0);
    if (!ganho) continue;
    const parcial = (m.hist || []).length >= MAX_HIST;
    let tirado = 0;
    if (aplicar) {
      let falta = ganho;
      for (const onde of ["carteira", "banco", "poupanca"]) {
        const tem = onde === "poupanca" ? Math.floor(m.poupanca?.valor || 0) : Math.floor(m[onde] || 0);
        const v = Math.min(tem, falta);
        if (v <= 0) continue;
        if (onde === "poupanca") m.poupanca.valor -= v; else m[onde] -= v;
        falta -= v; tirado += v;
      }
      for (const h of premios) h.estornado = 1;
      anotar(m, "estorno do nível", -tirado, por);
    }
    r.pessoas.push({ k, ganho, tirado, parcial });
    r.total += ganho; r.tirado += tirado; if (parcial) r.parciais++;
  }
  r.pessoas.sort((a, b) => b.ganho - a.ganho);
  if (aplicar && r.pessoas.length) marcar(jid);
  return r;
}
def(["estornarnivel", "tirarmoedasnivel", "estornonivel"], DONO_G, async (c) => {
  const args = c.args.map((a) => a.toLowerCase());
  const confirmar = args.includes("confirmar");
  const grupos = [c.jid];
  if (!confirmar) {
    const rs = grupos.map((jid) => estornoNivel(jid, false));
    const total = rs.reduce((s, r) => s + r.total, 0), pessoas = rs.reduce((s, r) => s + r.pessoas.length, 0), parciais = rs.reduce((s, r) => s + r.parciais, 0);
    if (!pessoas) return c.responder("Ninguém tem moedas de nível para tirar.");
    const top = rs[0].pessoas.slice(0, 10);
    return c.responder(`🧾 *ESTORNO DAS MOEDAS DE NÍVEL* (todas as contas desta Hina)\n\n` +
      `👥 *${pessoas}* pessoa(s) ganharam *${moedas(total)}* subindo de nível.\n` +
      (top.length ? `\n${top.map((p, i) => `${i + 1}. ${mk(c.jid, p.k)} — ${moedas(p.ganho)}`).join("\n")}\n` : "") +
      `\nA Hina tira da carteira, depois do banco e da poupança. O saldo nunca fica negativo.` +
      (parciais ? `\n⚠️ ${parciais} conta(s) têm o extrato cheio (40 movimentações): prêmios mais antigos que isso não aparecem e não serão tirados.` : "") +
      `\n\nPara confirmar: *${c.prefixo}estornarnivel confirmar*`, top.map((p) => jidDe(c.jid, p.k)));
  }
  const por = chave(c.jid, c.autorJid);
  const rs = grupos.map((jid) => estornoNivel(jid, true, por));
  const total = rs.reduce((s, r) => s + r.total, 0), tirado = rs.reduce((s, r) => s + r.tirado, 0), pessoas = rs.reduce((s, r) => s + r.pessoas.length, 0);
  if (!pessoas) return c.responder("Não havia moedas de nível para tirar.");
  logAdmin(c, "estornarnivel", null, tirado, null);
  gravarEconomia();
  return c.responder(`✅ *Moedas de nível estornadas.*\n\n👥 ${pessoas} pessoa(s)\n➖ Tirado: *${moedas(tirado)}* de ${moedas(total)}` +
    (tirado < total ? `\n_Faltaram ${moedas(total - tirado)}: algumas pessoas já tinham gastado, e o saldo não fica negativo._` : "") +
    `\n_Rodar de novo não tira duas vezes._`);
});

const ENQ_DURACAO = HORA, ENQ_MIN = 700, ENQ_MAX = 10_000_000;
const MEDALHA = ["🥇", "🥈", "🥉"];
const premiosEnq = (total) => { const a = Math.round(total * 4 / 7), b = Math.round(total * 2 / 7); return [a, b, total - a - b]; };
const horaBr = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
const limpo = (s, n) => String(s || "").replace(/[\u0000-\u001f*_~`]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
function lerEnquete(texto) {
  let t = String(texto || "").trim();
  const mt = /(?:^|\s)([\d.,]+k?)\s*$/i.exec(t);
  if (!mt) return { erro: "falta o total de moedas no final" };
  const total = lerValor(mt[1], 0);
  t = t.slice(0, mt.index).trim();
  let pergunta, opcoes;
  if (t.includes("|")) {
    [pergunta, ...opcoes] = t.split("|").map((x) => limpo(x, 80));
  } else {
    pergunta = limpo(t, 200);
    const semFim = t.replace(/[?!.]+\s*$/, "");
    const i = semFim.indexOf(",");
    const trecho = i >= 0 ? semFim.slice(i + 1) : semFim;
    opcoes = / ou /i.test(trecho) ? trecho.split(/,| ou /i).map((x) => limpo(x, 60)) : [];
  }
  opcoes = [...new Set(opcoes.filter(Boolean))];
  if (opcoes.length < 2 || opcoes.length > 6) return { erro: "não achei as opções (de 2 a 6)" };
  if (!(total >= ENQ_MIN && total <= ENQ_MAX)) return { erro: `o total vai de ${moedas(ENQ_MIN)} a ${moedas(ENQ_MAX)}` };
  return { pergunta: pergunta || "Enquete", opcoes, total };
}
const regrasEnq = (p, e) => `📜 *REGRAS*\n` +
  `1. Votar é *de graça*: ninguém aposta moedas. O prêmio é do dono.\n` +
  `2. Vote na *enquete do WhatsApp* logo abaixo (ou com *${p}votar 1*). Um voto por pessoa: *vale o primeiro voto*; trocar na enquete depois não muda.\n` +
  `3. Vale para quem já estava no grupo quando a enquete abriu. Dono e equipe não votam.\n` +
  `4. A votação fica aberta por *1 hora* (até ${horaBr(e.fim)}).\n` +
  `5. Depois, o dono informa o resultado com base em sites de notícias confiáveis, *com o link da fonte* para todos conferirem.\n` +
  `6. Ganham os *3 primeiros* que votaram na opção certa, pela ordem do voto (empate = quem votou primeiro): ${premiosEnq(e.total).map((v, i) => `${MEDALHA[i]} ${moedas(v)}`).join(" · ")}.\n` +
  `7. Se ninguém acertar ou a enquete for cancelada, ninguém ganha.\n` +
  `8. O placar oficial é o da Hina (*${p}enquete*): ele já tira votos trocados, de fora do prazo e de quem não pode votar.`;
function placarEnq(e) {
  const total = e.votos.length || 1;
  return e.opcoes.map((o, i) => { const n = e.votos.filter((v) => v.opcao === i).length; const pct = Math.round((n / total) * 100); return `${i + 1}. *${o}* — ${n} voto(s) ${"▰".repeat(Math.round(pct / 10))}${"▱".repeat(10 - Math.round(pct / 10))} ${e.votos.length ? pct : 0}%`; }).join("\n");
}
const enqueteDe = (jid) => dados(jid).enquete || null;
const indiceEnq = () => (contasGlobais().enquetes ||= []);

def(["enquete", "enquetedono"], G, async (c) => {
  const p = c.prefixo;
  const e = enqueteDe(c.jid);
  const sub = String(c.args[0] || "").toLowerCase();
  if (!c.texto.trim() || (["regras", "status", "ver"].includes(sub) && c.args.length === 1)) {
    if (!e) return c.responder(`📊 Não há enquete aberta neste grupo.${c.ehDono ? `\n\nPara criar (só o dono):\n*${p}enquete Quem vence, Time A ou Time B? 35000*\nou com barras: *${p}enquete Quem vence? | Time A | Time B | 35000*` : ""}`);
    const fase = e.fase === "aberta" ? `⏳ Votação aberta por mais *${espera(e.fim - Date.now())}*` : "🔒 Votação encerrada · aguardando o dono informar o resultado com a fonte";
    return c.responder(`📊 *ENQUETE* — ${e.pergunta}\n\n${placarEnq(e)}\n\n👥 ${e.votos.length} voto(s) · ${fase}\n🏆 Prêmio total: ${moedas(e.total)}\n\n${regrasEnq(p, e)}`);
  }
  if (!c.ehDono) return c.responder("📊 Só o dono da Hina cria e encerra enquetes. Para votar: *" + p + "votar 1*.");
  if (sub === "cancelar") {
    if (!e) return c.responder("Não há enquete para cancelar.");
    delete dados(c.jid).enquete;
    contasGlobais().enquetes = indiceEnq().filter((j) => j !== c.jid);
    logAdmin(c, "enquete cancelada", null, null, e.pergunta);
    marcar(c.jid);
    return c.responder(`❌ Enquete cancelada pelo dono: _${e.pergunta}_\nNinguém ganha prêmio.`);
  }
  if (sub === "resultado") {
    if (!e) return c.responder("Não há enquete aberta.");
    if (e.fase === "aberta" && e.fim > Date.now()) return c.responder(`⏳ A votação ainda está aberta (fecha às ${horaBr(e.fim)}). O resultado só vale depois que ela fechar.`);
    const [, opTxt, link, ...resto] = c.args;
    const idx = /^\d+$/.test(opTxt || "") ? Number(opTxt) - 1 : e.opcoes.findIndex((o) => o.toLowerCase() === String(opTxt || "").toLowerCase());
    if (!(idx >= 0 && idx < e.opcoes.length)) return c.responder(`Diga qual opção venceu: *${p}enquete resultado 1 https://link-da-noticia [percentuais]*\n${e.opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
    let url;
    try { url = new URL(String(link || "")); } catch {}
    if (!url || url.protocol !== "https:") return c.responder(`Mande o link (https) da notícia que confirma o resultado, para todos conferirem:\n*${p}enquete resultado ${idx + 1} https://site-da-noticia.com/...*`);
    const certos = e.votos.filter((v) => v.opcao === idx).sort((a, b) => a.t - b.t || a.n - b.n);
    const premios = premiosEnq(e.total);
    const ganhadores = certos.slice(0, 3).map((v, i) => ({ ...v, premio: premios[i] }));
    for (const g of ganhadores) creditar(c.jid, jidDe(c.jid, g.k), g.premio, { tipo: "prêmio da enquete" });
    const nota = limpo(resto.join(" "), 200);
    delete dados(c.jid).enquete;
    contasGlobais().enquetes = indiceEnq().filter((j) => j !== c.jid);
    logAdmin(c, "enquete resultado", null, ganhadores.reduce((s, g) => s + g.premio, 0), `${e.opcoes[idx]} · ${url.hostname}`);
    (dados(c.jid).enquetesAntigas ||= []).push({ pergunta: e.pergunta, opcoes: e.opcoes, vencedora: idx, fonte: url.href, nota, votos: e.votos.length, ganhadores: ganhadores.map((g) => ({ k: g.k, premio: g.premio, t: g.t })), em: Date.now() });
    dados(c.jid).enquetesAntigas = dados(c.jid).enquetesAntigas.slice(-10);
    marcar(c.jid);
    const lista = ganhadores.length ? ganhadores.map((g, i) => `${MEDALHA[i]} ${mk(c.jid, g.k)} — *+${moedas(g.premio)}* _(votou às ${horaBr(g.t)}, voto nº ${g.n})_`).join("\n") : "Ninguém acertou, então ninguém ganha prêmio.";
    return c.responder(`🏁 *RESULTADO DA ENQUETE*\n_${e.pergunta}_\n\n✅ Opção certa: *${e.opcoes[idx]}*\n📰 Fonte: ${url.href}${nota ? `\n📈 ${nota}` : ""}\n\n${placarEnq(e)}\n\n🏆 *Ganhadores* (os 3 primeiros que acertaram, pela ordem do voto):\n${lista}\n\n` +
      `🎯 Acertaram: ${certos.length} de ${e.votos.length} voto(s).${certos.length > 3 ? `\n_Próximos da fila (sem prêmio): ${certos.slice(3, 8).map((v) => `${mk(c.jid, v.k)} (${horaBr(v.t)})`).join(", ")}_` : ""}\n_O prêmio já está na carteira (vale em todos os grupos)._`,
      [...ganhadores, ...certos.slice(3, 8)].map((g) => jidDe(c.jid, g.k)));
  }
  if (e) return c.responder(`Já tem uma enquete neste grupo (_${e.pergunta}_). Veja com *${p}enquete* ou cancele com *${p}enquete cancelar*.`);
  const lido = lerEnquete(c.texto);
  if (lido.erro) return c.responder(`📊 Não entendi a enquete: ${lido.erro}.\n\nExemplos:\n*${p}enquete Quem vence, Time A ou Time B? 35000*\n*${p}enquete Quem vence o clássico? | Flamengo | Vasco | Empate | 35000*`);
  const presentes = [...presentesNoGrupo(c.jid, c.meta)];
  const nova = { ...lido, fase: "aberta", criadaEm: Date.now(), fim: Date.now() + ENQ_DURACAO, por: chave(c.jid, c.autorJid), aptos: presentes, votos: [] };
  dados(c.jid).enquete = nova;
  if (!indiceEnq().includes(c.jid)) indiceEnq().push(c.jid);
  lembrarNomeDoGrupo(c.jid, c.meta?.subject);
  logAdmin(c, "enquete criada", null, nova.total, nova.pergunta);
  const segredo = crypto.randomBytes(32);
  nova.poll = { id: null, secret: segredo.toString("base64"), hashes: nova.opcoes.map((o) => crypto.createHash("sha256").update(Buffer.from(o)).digest("hex")) };
  marcar(c.jid);
  await c.responder(`📊 *ENQUETE DO DONO*\n\n❓ *${nova.pergunta}*\n🏆 Prêmio total: *${moedas(nova.total)}*\n\n🗳️ Vote na enquete aqui embaixo 👇 (ou *${p}votar 1*)\n\n${regrasEnq(p, nova)}`);
  try {
    const enviada = await c.sock.sendMessage(c.jid, { poll: { name: `📊 ${nova.pergunta}`.slice(0, 250), values: nova.opcoes, selectableCount: 1, messageSecret: segredo } });
    nova.poll.id = enviada?.key?.id || null;
    marcar(c.jid);
  } catch {
    return c.responder(`😕 Não consegui mandar a enquete do WhatsApp agora. Votem com *${p}votar 1*:\n${nova.opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
  }
});

export async function receberVotoEnquete(sock, msg, m) {
  const upd = m?.pollUpdateMessage;
  const jid = msg?.key?.remoteJid;
  const e = jid && ehGrupo(jid) ? enqueteDe(jid) : null;
  if (!upd?.vote || !e?.poll?.id || upd.pollCreationMessageKey?.id !== e.poll.id) return null;
  const { decryptPollVote, jidNormalizedUser } = await import("baileys");
  const k = msg.key;
  const votantes = [...new Set([k.participant, k.participantPn, k.participantAlt, k.participantLid, msg.participant].filter(Boolean).map((j) => jidNormalizedUser(j)))];
  const criadores = [...new Set([sock?.user?.id, sock?.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j)))];
  const chaveEnc = Buffer.from(e.poll.secret, "base64");
  let voto = null, votante = null;
  for (const v of votantes) {
    for (const cr of criadores) { try { voto = decryptPollVote(upd.vote, { pollEncKey: chaveEnc, pollCreatorJid: cr, pollMsgId: e.poll.id, voterJid: v }); votante = v; break; } catch {} }
    if (voto) break;
  }
  if (!voto) return null;
  const escolhidos = (voto.selectedOptions || []).map((b) => Buffer.from(b).toString("hex"));
  const idx = e.poll.hashes.findIndex((h) => escolhidos.includes(h));
  if (idx < 0) return { removido: true };
  const ts = Number(upd.senderTimestampMs?.toNumber ? upd.senderTimestampMs.toNumber() : upd.senderTimestampMs) || Date.now();
  const autor = k.participant || votante;
  const kk = chave(jid, autor);
  e.avisados ||= [];
  const avisar = async (texto) => {
    if (e.avisados.includes(kk)) return;
    e.avisados.push(kk); marcar(jid);
    await sock?.sendMessage(jid, { text: texto, mentions: [jidDe(jid, kk)] }).catch(() => {});
  };
  if (e.fase !== "aberta" || ts > e.fim) return avisar(`🔒 ${mk(jid, kk)}, a votação já tinha encerrado: esse voto não conta.`);
  const { papelDe } = await import("./dono.js").catch(() => ({ papelDe: () => null }));
  if (papelDe(votantes.map(usuario)) || kk === e.por) return avisar(`🙅 ${mk(jid, kk)}, dono e equipe não votam (são eles que informam o resultado). Esse voto não conta.`);
  if (!(e.aptos || []).includes(kk)) return avisar(`🙅 ${mk(jid, kk)}, esta enquete vale só para quem já estava no grupo quando ela abriu. Esse voto não conta.`);
  const ja = e.votos.find((v) => v.k === kk);
  if (ja) return ja.opcao === idx ? null : avisar(`📌 ${mk(jid, kk)}, vale o seu primeiro voto: *${e.opcoes[ja.opcao]}* (voto nº ${ja.n}). Trocar na enquete não muda.`);
  e.votos.push({ k: kk, opcao: idx, t: ts, n: e.votos.length + 1, origem: "enquete" });
  e.votos.sort((a, b) => a.t - b.t);
  e.votos.forEach((v, i) => { v.n = i + 1; });
  marcar(jid);
  return { opcao: idx };
}

def(["votar", "voto"], G, async (c) => {
  const e = enqueteDe(c.jid);
  if (!e) return c.responder("📊 Não há enquete aberta neste grupo.");
  if (e.fase !== "aberta" || e.fim <= Date.now()) return c.responder("🔒 A votação já encerrou. Agora é esperar o resultado com a fonte.");
  if (e.poll?.id && !c.texto.trim()) return c.responder("🗳️ Vote na enquete do WhatsApp que a Hina mandou (ou use *" + c.prefixo + "votar 1*).");
  if (c.ehDono || c.ehEquipe) return c.responder("🙅 Dono e equipe não votam: são eles que informam o resultado.");
  const k = chave(c.jid, c.autorJid);
  if (!(e.aptos || []).includes(k)) return c.responder("🙅 Esta enquete vale só para quem já estava no grupo quando ela abriu.");
  const ja = e.votos.find((v) => v.k === k);
  if (ja) return c.responder(`✅ Você já votou em *${e.opcoes[ja.opcao]}* às ${horaBr(ja.t)} (voto nº ${ja.n}). O voto não pode ser trocado.`);
  const txt = c.texto.trim();
  const idx = /^\d+$/.test(txt) ? Number(txt) - 1 : e.opcoes.findIndex((o) => o.toLowerCase() === txt.toLowerCase());
  if (!(idx >= 0 && idx < e.opcoes.length)) return c.responder(`Escolha uma opção: *${c.prefixo}votar 1*\n${e.opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
  const voto = { k, opcao: idx, t: Date.now(), n: e.votos.length + 1 };
  e.votos.push(voto);
  marcar(c.jid);
  return c.responder(`🗳️ ${marca(c.autorJid)} votou em *${e.opcoes[idx]}*.\n🕒 ${horaBr(voto.t)} · voto nº *${voto.n}* (a ordem vale como desempate)\n⏳ Fecha em ${espera(e.fim - Date.now())}.`, [c.autorJid]);
});

export function fecharEnquetes() {
  const avisos = [];
  for (const jid of [...indiceEnq()]) {
    const e = enqueteDe(jid);
    if (!e) { contasGlobais().enquetes = indiceEnq().filter((j) => j !== jid); continue; }
    if (e.fase !== "aberta" || e.fim > Date.now()) continue;
    e.fase = "fechada"; e.fechadaEm = Date.now();
    marcar(jid);
    avisos.push({ jid, texto: `🔒 *VOTAÇÃO ENCERRADA*\n_${e.pergunta}_\n\n${placarEnq(e)}\n\n👥 ${e.votos.length} voto(s). Agora o dono informa o resultado com o link de um site de notícias confiável:\n*!enquete resultado <nº> <link>*` });
  }
  return avisos;
}
setInterval(async () => {
  const avisos = fecharEnquetes();
  if (!avisos.length) return;
  const sock = (await import("./conexao.js").catch(() => null))?.sockAtual?.();
  for (const a of avisos) await sock?.sendMessage(a.jid, { text: a.texto }).catch(() => {});
}, 30_000).unref?.();

def(["setmoeda", "definirmoeda"], DONO_G, async (c) => {
  const { alvo, noBanco, valorTxt, motivo } = pedidoAdmin(c);
  const valor = Math.floor(Number(String(valorTxt ?? "").replace(/\./g, "")));
  if (!alvo || !(valor >= 0) || valor > 1e12) return usoAdmin(c, "setmoeda", "5000");
  const m = conta(c.jid, alvo);
  if (noBanco) m.banco = valor; else m.carteira = valor;
  logAdmin(c, "setmoeda", alvo, valor, motivo);
  marcar(c.jid);
  return c.responder(`✏️ ${noBanco ? "Banco" : "Carteira"} de ${marca(alvo)} definido(a) em *${moedas(valor)}*.`, [alvo]);
});

def(["vercarteira", "vereco"], EQUIPE_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}vercarteira @fulano* (ou respondendo a mensagem).`);
  const m = conta(c.jid, alvo);
  const cdb = (m.cdbs || []).reduce((s, x) => s + x.valor, 0);
  const acoes = Object.entries(m.acoes).filter(([, a]) => a?.qtd > 0).map(([t, a]) => `${t}×${fmt(a.qtd)}`).join(", ") || "nenhuma";
  const itens = Object.entries(m.itens).filter(([, q]) => q > 0).map(([k, q]) => `${ITENS[k]?.emoji || k}×${q}`).join(" ") || "nenhuma";
  return c.responder(`🔎 *CARTEIRA (DONO)* — ${marca(alvo)}\n\n👛 Mão: ${moedas(m.carteira)}\n🏦 Banco: ${moedas(m.banco)}\n🐷 Poupança: ${moedas(m.poupanca?.valor || 0)}\n🏛️ CDB: ${moedas(cdb)}\n📈 Ações: ${acoes}\n🏠 Propriedades: ${itens}\n💎 Patrimônio: *${moedas(patrimonio(m))}*\n\n🛒 Resgatado do site: ${moedas(m.comprado || 0)}\n🎰 Apostado: ${moedas(m.apostado || 0)} · voltou ${moedas(m.ganhoApostas || 0)}\n📅 No RPG desde: ${m.criadoEm ? new Date(m.criadoEm).toLocaleDateString("pt-BR") : "antes do registro"}\n📜 Termos: ${(m.termosHist || []).length ? m.termosHist.map((t) => `v${t.versao} em ${new Date(t.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`).join(" · ") : "ainda não aceitou"}${m.congelado ? `\n🧊 *Congelada*${m.congelado.motivo ? `: ${m.congelado.motivo}` : ""}` : ""}\n\n_Histórico: ${c.prefixo}logeco @_`, [alvo]);
});

def(["logeco", "extratoeco", "historicoeco"], EQUIPE_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) {
    const log = (dados(c.jid).logAdmin || []).slice(-15).reverse();
    if (!log.length) return c.responder(`Nenhuma ação do dono registrada aqui. Para o histórico de alguém: *${c.prefixo}logeco @fulano*`);
    return c.responder(`📜 *AÇÕES DO DONO NA ECONOMIA*\n\n${log.map((x) => `• ${new Date(x.t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — ${x.acao}${x.alvo ? ` ${mk(c.jid, x.alvo)}` : ""}${x.valor != null ? ` ${moedas(x.valor)}` : ""} (por ${mk(c.jid, x.por)})${x.extra ? ` · ${x.extra}` : ""}`).join("\n")}`,
      [...new Set(log.flatMap((x) => [x.alvo, x.por]).filter(Boolean))].map((n) => jidDe(c.jid, n)));
  }
  const m = conta(c.jid, alvo);
  const h = (m.hist || []).slice(-15).reverse();
  if (!h.length) return c.responder(`${marca(alvo)} ainda não tem movimentações.`, [alvo]);
  return c.responder(`📜 *EXTRATO* — ${marca(alvo)}\n\n${h.map((x) => `${x.v > 0 ? "🟢 +" : "🔴 −"}${fmt(Math.abs(x.v))} · ${x.tipo}${x.por ? ` (por ${x.por === "sistema" ? "sistema" : `${mk(c.jid, x.por)}`})` : ""}\n   _${new Date(x.t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · mão: ${fmt(x.s)}_`).join("\n")}`, [alvo]);
});

def(["zerarcarteira", "resetcarteira"], DONO_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}zerarcarteira @fulano confirmar*`);
  if (!valoresDe(c).some((x) => x.toLowerCase() === "confirmar")) return c.responder(`⚠️ Isso zera carteira, banco, poupança, CDBs, ações e propriedades de ${marca(alvo)} *em todos os grupos* (a carteira é uma só). Confirme: *${c.prefixo}zerarcarteira @${usuario(alvo)} confirmar*`, [alvo]);
  const m = conta(c.jid, alvo);
  Object.assign(m, { carteira: 0, banco: 0, acoes: {}, itens: {}, poupanca: { valor: 0, em: Date.now(), juros: 0 }, cdbs: [] });
  logAdmin(c, "zerarcarteira", alvo);
  marcar(c.jid);
  return c.responder(`🧹 Economia de ${marca(alvo)} zerada (a carteira vale em todos os grupos, então zerou em todos).`, [alvo]);
});

def(["congelar", "congelarconta"], DONO_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}congelar @fulano [motivo]*`);
  const motivo = valoresDe(c).join(" ").slice(0, 80) || null;
  conta(c.jid, alvo).congelado = { em: Date.now(), por: usuario(c.autorJid), motivo };
  logAdmin(c, "congelar", alvo, null, motivo);
  marcar(c.jid);
  return c.responder(`🧊 Conta de ${marca(alvo)} congelada: não usa a economia nem recebe transferências.${motivo ? `\n📝 ${motivo}` : ""}\n_Para liberar: ${c.prefixo}descongelar @${usuario(alvo)}_`, [alvo]);
});
def(["descongelar", "descongelarconta"], DONO_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}descongelar @fulano*`);
  const m = conta(c.jid, alvo);
  if (!m.congelado) return c.responder(`${marca(alvo)} não está congelado(a).`, [alvo]);
  delete m.congelado;
  logAdmin(c, "descongelar", alvo);
  marcar(c.jid);
  return c.responder(`🔥 Conta de ${marca(alvo)} liberada.`, [alvo]);
});

def(["ecogrupo", "economiagrupo"], EQUIPE_G, async (c) => {
  const d = dados(c.jid);
  const membros = contasDoGrupo(c.jid, c.meta);
  let mao = 0, banco = 0, poup = 0, cdb = 0, comprado = 0, congelados = 0;
  for (const [, m] of membros) {
    mao += m.carteira || 0; banco += m.banco || 0; poup += m.poupanca?.valor || 0; cdb += (m.cdbs || []).reduce((s, x) => s + x.valor, 0);
    comprado += m.comprado || 0; if (m.congelado) congelados++;
  }
  const r = resumoDoGrupo(c.jid);
  const adm = (d.logAdmin || []).reduce((s, x) => s + (x.acao === "addmoeda" ? x.valor || 0 : x.acao === "rmvmoeda" ? -(x.valor || 0) : 0), 0);
  const top = membros.map(([n, m]) => [n, patrimonio(m)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return c.responder(`📊 *ECONOMIA DO GRUPO*\n_Quem está no grupo; as carteiras valem em todos os grupos._\n\n👥 Contas: ${membros.length} (${r.members} com saldo)${congelados ? ` · 🧊 ${congelados} congelada(s)` : ""}\n💎 Patrimônio total: *${moedas(r.total)}*\n👛 Na mão: ${moedas(mao)}\n🏦 Bancos: ${moedas(banco)}\n🐷 Poupanças: ${moedas(poup)}\n🏛️ CDBs: ${moedas(cdb)}\n🛒 Resgatado do site: ${moedas(comprado)}\n👑 Ajustes do dono (saldo): ${adm >= 0 ? "+" : "−"}${moedas(Math.abs(adm))}\n\n🏆 Top 5:\n${top.map(([n, p], i) => `${i + 1}. ${mk(c.jid, n)} — ${moedas(p)}`).join("\n") || "—"}`,
    top.map(([n]) => jidDe(c.jid, n)));
});

const MOLDURAS = {
  simples: { nome: "Simples", preco: 0, topo: "", base: "" },
  estrela: { nome: "Estrelada", preco: 5_000, topo: "✦ ⋆ ✧ ⋆ ✦ ⋆ ✧ ⋆ ✦", base: "✦ ⋆ ✧ ⋆ ✦ ⋆ ✧ ⋆ ✦" },
  sakura: { nome: "Sakura", preco: 12_000, topo: "🌸━━━━━━ ✿ ━━━━━━🌸", base: "🌸━━━━━━ ✿ ━━━━━━🌸" },
  neon: { nome: "Neon", preco: 25_000, topo: "▰▱▰▱▰ ⚡ ▰▱▰▱▰", base: "▰▱▰▱▰ ⚡ ▰▱▰▱▰" },
  real: { nome: "Real", preco: 50_000, topo: "👑═══════ ✠ ═══════👑", base: "👑═══════ ✠ ═══════👑" },
  galaxia: { nome: "Galáxia", preco: 80_000, topo: "🌌 ･ﾟ✧*:･ﾟ✧ 🪐 ✧ﾟ･:*✧ﾟ･ 🌌", base: "🌌 ･ﾟ✧*:･ﾟ✧ 🪐 ✧ﾟ･:*✧ﾟ･ 🌌" },
  diamante: { nome: "💎 Diamante VIP", vip: true, topo: "💎━━━━ ⟢ 𝐕𝐈𝐏 ⟣ ━━━━💎", base: "💎━━━━ ⟢ 𝐕𝐈𝐏 ⟣ ━━━━💎" }
};
const TITULOS = {
  novato: { nome: "🌱 Novato", preco: 0 },
  aventureiro: { nome: "🗺️ Aventureiro", preco: 8_000 },
  colecionador: { nome: "🧩 Colecionador", preco: 20_000 },
  magnata: { nome: "💼 Magnata", preco: 40_000 },
  lenda: { nome: "🐉 Lenda da Hina", preco: 120_000 },
  vip: { nome: "💎 VIP", vip: true }
};
const PRECO_TITULO_LIVRE = 100_000;
const PALAVRAS_PROIBIDAS = /(porra|caralh|puta|merda|buceta|cu\b|fdp|vsf|arrombad|viad|bicha|macac|nazi|hitler)/i;
function cosmeticos(m) {
  m.cosm ||= { molduras: ["simples"], titulos: ["novato"], moldura: "simples", titulo: "novato", livre: null };
  return m.cosm;
}
const tituloDe = (m) => {
  const k = cosmeticos(m);
  if (k.titulo === "livre" && k.livre) return `✨ ${k.livre}`;
  const tt = TITULOS[k.titulo];
  if (tt?.vip && !ehVipConta(m)) return TITULOS.novato.nome;
  return tt?.nome || TITULOS.novato.nome;
};

function posicaoNoGrupo(jid, id) {
  if (!ehGrupo(jid)) return null;
  const lista = contasDoGrupo(jid).map(([n, m]) => [n, patrimonio(m)]).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  const i = lista.findIndex(([n]) => n === chave(jid, id));
  return i >= 0 ? i + 1 : null;
}
const DESTAQUE = { 1: "👑 *O MAIS RICO DO GRUPO*", 2: "💎 *VICE-MILIONÁRIO*", 3: "🥉 *TERCEIRA FORTUNA*" };

const CONQUISTAS = [
  { id: "primeiro-mil", nome: "💰 Primeiro milhar", desc: "patrimônio de 🪙 1.000", premio: 135, ok: (m) => patrimonio(m) >= 1_000 },
  { id: "fiel", nome: "🔥 Fiel", desc: "7 dias seguidos de diário", premio: 340, ok: (m) => (m.sequencia || 0) >= 7 },
  { id: "poupador", nome: "🐷 Poupador", desc: "🪙 10.000 na poupança", premio: 270, ok: (m) => (m.poupanca?.valor || 0) >= 10_000 },
  { id: "investidor", nome: "📈 Investidor", desc: "ter ações de 3 empresas", premio: 340, ok: (m) => Object.values(m.acoes || {}).filter((a) => a?.qtd > 0).length >= 3 },
  { id: "empresario", nome: "🏢 Empresário", desc: "5 propriedades", premio: 405, ok: (m) => Object.values(m.itens || {}).reduce((s, q) => s + q, 0) >= 5 },
  { id: "estiloso", nome: "🖼️ Estiloso", desc: "3 molduras na coleção", premio: 340, ok: (m) => cosmeticos(m).molduras.length >= 3 },
  { id: "rico", nome: "💎 Rico", desc: "patrimônio de 🪙 100.000", premio: 540, ok: (m) => patrimonio(m) >= 100_000 },
  { id: "milionario", nome: "🏆 Milionário", desc: "patrimônio de 🪙 1.000.000", premio: 676, ok: (m) => patrimonio(m) >= 1_000_000 }
];
function conferirConquistas(m) {
  m.conquistas ||= {};
  const novas = [];
  for (const q of CONQUISTAS) {
    if (m.conquistas[q.id] || !q.ok(m)) continue;
    m.conquistas[q.id] = Date.now();
    m.carteira += ganho("conquistas", q.premio, m);
    novas.push(q);
  }
  return novas;
}

export function decorarPerfil(jid, id, texto) {
  try {
    if (!cfgRpg(jid).economia) return texto;
    const m = conta(jid, id);
    const k = cosmeticos(m);
    const pos = posicaoNoGrupo(jid, id);
    const qtd = Object.keys(m.conquistas || {}).length;
    const cal = dividaAtrasada(jid, id);
    const extra = `${ehVipConta(m) ? "\n💎 *VIP*" : ""}${cal ? `\n📛 *CALOTEIRO(A)* — deve ${moedas(restante(cal))}` : ""}\n🎖️ Título: *${tituloDe(m)}*\n💎 Patrimônio: *${moedas(patrimonio(m))}*${pos ? ` (${pos}º do grupo)` : ""}\n🏅 Conquistas: *${qtd}/${CONQUISTAS.length}*`;
    const corpo = `${pos && DESTAQUE[pos] ? `${DESTAQUE[pos]}\n\n` : ""}${texto}${extra}`;
    let mol = MOLDURAS[k.moldura] || MOLDURAS.simples;
    if (mol.vip && !ehVipConta(m)) mol = MOLDURAS.simples;
    const usar = mol.topo ? mol : pos && pos <= 3 ? MOLDURAS.real : null;
    return usar ? `${usar.topo}\n${corpo}\n${usar.base}` : corpo;
  } catch { return texto; }
}

def(["molduras", "moldura"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const k = cosmeticos(m);
  const [acao, nome] = [String(c.args[0] || "").toLowerCase(), String(c.args[1] || "").toLowerCase()];
  const it = MOLDURAS[nome];
  if (acao === "comprar") {
    if (!it) return c.responder(`Moldura não encontrada. Veja as opções em *${c.prefixo}molduras*.`);
    if (it.vip) return c.responder(`A moldura *${it.nome}* é exclusiva do VIP: ela não é vendida. Seja VIP com *${c.prefixo}vip* e use com *${c.prefixo}molduras usar ${nome}*.`);
    if (k.molduras.includes(nome)) return c.responder(`Você já tem a moldura *${it.nome}*. Use: *${c.prefixo}molduras usar ${nome}*`);
    if (it.preco > m.carteira) return c.responder(`A moldura *${it.nome}* custa ${moedas(it.preco)}. Você tem ${moedas(m.carteira)} na mão.`);
    m.carteira -= it.preco; k.molduras.push(nome); k.moldura = nome;
    const novas = conferirConquistas(m);
    marcar(c.jid);
    return c.responder(`🖼️ Comprou e já está usando a moldura *${it.nome}*! Veja no *${c.prefixo}perfil*.${novas.map((q) => `\n🏅 Conquista: *${q.nome}* (+${moedas(ganho("conquistas", q.premio, m))})`).join("")}`);
  }
  if (acao === "usar") {
    if (it?.vip) { if (!ehVipConta(m)) return c.responder(`A moldura *${it.nome}* é só para VIP. Seja VIP com *${c.prefixo}vip*.`); k.moldura = nome; marcar(c.jid); return c.responder(`🖼️ Moldura *${it.nome}* aplicada! 💎`); }
    if (!it || !k.molduras.includes(nome)) return c.responder(`Você não tem essa moldura. Suas: ${k.molduras.join(", ")}.`);
    k.moldura = nome; marcar(c.jid);
    return c.responder(`🖼️ Moldura *${it.nome}* aplicada no seu perfil.`);
  }
  const linhas = Object.entries(MOLDURAS).map(([id, x]) => `${k.moldura === id ? "✅" : x.vip ? (ehVipConta(m) ? "💎" : "🔒") : k.molduras.includes(id) ? "☑️" : "▫️"} *${x.nome}* (${id}) — ${x.vip ? "só VIP" : x.preco ? moedas(x.preco) : "grátis"}${x.topo ? `\n   ${x.topo}` : ""}`);
  return c.responder(`🖼️ *MOLDURAS DO PERFIL*\n\n${linhas.join("\n")}\n\n• *${c.prefixo}molduras comprar sakura*\n• *${c.prefixo}molduras usar sakura*\n\n_Compra única: a moldura fica sua para sempre. Os 3 mais ricos do grupo ganham a moldura Real enquanto estiverem no top 3._`);
});

def(["titulos", "titulo", "título", "títulos"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const k = cosmeticos(m);
  const [acao, nome] = [String(c.args[0] || "").toLowerCase(), String(c.args[1] || "").toLowerCase()];
  if (acao === "personalizado" || acao === "livre") {
    const texto = c.args.slice(1).join(" ").replace(/[*_~`\n]/g, "").trim().slice(0, 24);
    if (texto.length < 3) return c.responder(`Escreva o título (3 a 24 letras): *${c.prefixo}titulos personalizado Rei do Pastel*\nCusta ${moedas(PRECO_TITULO_LIVRE)}${k.titulos.includes("livre") ? " — você já tem, trocar o texto é grátis" : ""}.`);
    if (PALAVRAS_PROIBIDAS.test(texto)) return c.responder("🚫 Esse título não pode. Escolha outro.");
    const pago = k.titulos.includes("livre");
    if (!pago && PRECO_TITULO_LIVRE > m.carteira) return c.responder(`O título personalizado custa ${moedas(PRECO_TITULO_LIVRE)}. Você tem ${moedas(m.carteira)} na mão.`);
    if (!pago) { m.carteira -= PRECO_TITULO_LIVRE; k.titulos.push("livre"); }
    k.livre = texto; k.titulo = "livre"; marcar(c.jid);
    return c.responder(`✨ Seu título agora é *${texto}*!${pago ? "" : `\n_(${moedas(PRECO_TITULO_LIVRE)}; trocar o texto depois é grátis.)_`}`);
  }
  const it = TITULOS[nome];
  if (acao === "comprar") {
    if (!it) return c.responder(`Título não encontrado. Veja em *${c.prefixo}titulos*.`);
    if (it.vip) return c.responder(`O título *${it.nome}* é exclusivo do VIP: não é vendido. Seja VIP com *${c.prefixo}vip* e use com *${c.prefixo}titulos usar ${nome}*.`);
    if (k.titulos.includes(nome)) return c.responder(`Você já tem *${it.nome}*. Use: *${c.prefixo}titulos usar ${nome}*`);
    if (it.preco > m.carteira) return c.responder(`*${it.nome}* custa ${moedas(it.preco)}. Você tem ${moedas(m.carteira)} na mão.`);
    m.carteira -= it.preco; k.titulos.push(nome); k.titulo = nome; marcar(c.jid);
    return c.responder(`🎖️ Agora você é *${it.nome}*!`);
  }
  if (acao === "usar") {
    if (nome === "livre" && k.titulos.includes("livre")) { k.titulo = "livre"; marcar(c.jid); return c.responder(`🎖️ Usando o título *${k.livre}*.`); }
    if (it?.vip) { if (!ehVipConta(m)) return c.responder(`O título *${it.nome}* é só para VIP. Seja VIP com *${c.prefixo}vip*.`); k.titulo = nome; marcar(c.jid); return c.responder(`🎖️ Título *${it.nome}* aplicado! 💎`); }
    if (!it || !k.titulos.includes(nome)) return c.responder("Você não tem esse título.");
    k.titulo = nome; marcar(c.jid);
    return c.responder(`🎖️ Título *${it.nome}* aplicado.`);
  }
  const linhas = Object.entries(TITULOS).map(([id, x]) => `${k.titulo === id ? "✅" : x.vip ? (ehVipConta(m) ? "💎" : "🔒") : k.titulos.includes(id) ? "☑️" : "▫️"} *${x.nome}* (${id}) — ${x.vip ? "só VIP" : x.preco ? moedas(x.preco) : "grátis"}`);
  return c.responder(`🎖️ *TÍTULOS*\n\n${linhas.join("\n")}\n${k.titulos.includes("livre") ? "✅" : "▫️"} *✨ Personalizado* — ${moedas(PRECO_TITULO_LIVRE)}\n\n• *${c.prefixo}titulos comprar magnata*\n• *${c.prefixo}titulos usar magnata*\n• *${c.prefixo}titulos personalizado Rei do Pastel*\n\n_O título aparece no ${c.prefixo}perfil e no ${c.prefixo}rankrico._`);
});

def(["conquistas", "medalhas"], G, async (c) => {
  if (!exigir(c)) return;
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const novas = mesmaPessoa(c, alvo, c.autorJid) ? conferirConquistas(m) : [];
  if (novas.length) marcar(c.jid);
  const linhas = CONQUISTAS.map((q) => `${m.conquistas?.[q.id] ? "🏅" : "🔒"} *${q.nome}* — ${q.desc} _(+${moedas(ganho("conquistas", q.premio, m))})_`);
  return c.responder(`🏅 *CONQUISTAS* — ${marca(alvo)}\n\n${linhas.join("\n")}\n\n${Object.keys(m.conquistas || {}).length}/${CONQUISTAS.length} liberadas.${novas.length ? `\n\n🎉 Acabou de liberar: ${novas.map((q) => `*${q.nome}* (+${moedas(ganho("conquistas", q.premio, m))})`).join(", ")}` : ""}\n_Cada conquista dá o prêmio uma vez só._`, [alvo]);
});

const RARIDADE = [["comum", 58, "⚪"], ["incomum", 24, "🟢"], ["raro", 11, "🔵"], ["épico", 5, "🟣"], ["lendário", 2, "🟡"]];
const COLETAS = {
  pescar: { titulo: "🎣 PESCARIA", verbo: "pescou", espera: HORA, nada: ["uma bota velha 🥾", "um pneu furado 🛞", "só alga 🌿"], itens: {
    comum: [["lambari", "🐟", 340], ["sardinha", "🐟", 370]], incomum: [["tilápia", "🐠", 405], ["robalo", "🐠", 440]],
    raro: [["salmão", "🍣", 505], ["polvo", "🐙", 540]], épico: [["tubarão-martelo", "🦈", 610]], lendário: [["peixe dourado da Hina", "✨🐟", 676]] } },
  minerar: { titulo: "⛏️ MINERAÇÃO", verbo: "minerou", espera: 5 * MIN, nada: ["só cascalho 🪨", "uma pedra qualquer 🪨"], itens: {
    comum: [["carvão", "⚫", 340], ["cobre", "🟤", 370]], incomum: [["ferro", "⚙️", 405], ["prata", "🥈", 440]],
    raro: [["ouro", "🥇", 505], ["esmeralda", "💚", 540]], épico: [["diamante", "💎", 610]], lendário: [["cristal Sorasaki", "🔮", 676]] } },
  cacar: { titulo: "🏹 CAÇADA", verbo: "caçou", espera: 10 * MIN, nada: ["só pegadas 🐾", "um galho seco 🌿"], itens: {
    comum: [["coelho", "🐇", 340], ["pato", "🦆", 370]], incomum: [["javali", "🐗", 405], ["veado", "🦌", 440]],
    raro: [["raposa de prata", "🦊", 505], ["urso", "🐻", 540]], épico: [["lobo alfa", "🐺", 610]], lendário: [["fênix", "🔥🐦", 676]] } }
};
const CHANCE_NADA = 0.08;
const REMEDIO = [10, 500];
const ALTA_MIN = 100, ALTA_MAX = 700, HOSPITAL_MAX = 4 * HORA;
const precoAlta = (falta) => Math.min(ALTA_MAX, Math.max(ALTA_MIN, Math.ceil((falta / HOSPITAL_MAX) * ALTA_MAX / 10) * 10));
const NOME_COLETA = { cacar: "caçar", minerar: "minerar" };
function pagarComMochila(m, valor) {
  const itens = Object.entries(m.mochila || {}).filter(([, q]) => q > 0).map(([n, q]) => [n, q, precoItem(n, m)]).sort((a, b) => a[2] - b[2]);
  let pago = 0;
  const usados = {};
  for (const [n, q, p] of itens) {
    for (let i = 0; i < q && pago < valor; i++) { pago += p; usados[n] = (usados[n] || 0) + 1; }
    if (pago >= valor) break;
  }
  for (const [n, q] of Object.entries(usados)) { m.mochila[n] -= q; if (m.mochila[n] <= 0) delete m.mochila[n]; }
  const troco = Math.max(0, pago - valor);
  if (troco) m.carteira += troco;
  return { pago, usados, troco };
}
const ACIDENTES = {
  cacar: { chance: 0.12, horas: [2, 4], local: "na selva", frases: [["foi atacado(a) por uma onça-pintada", "🐆"], ["deu de cara com um leão faminto", "🦁"], ["levou uma picada de jararaca", "🐍"],
    ["caiu num rio cheio de jacarés", "🐊"], ["foi perseguido(a) por um bando de javalis", "🐗"], ["tropeçou e rolou o barranco fugindo de um tigre", "🐅"]] },
  minerar: { chance: 0.12, horas: [1, 3], local: "na mina", frases: [["ficou preso(a) num desabamento", "🪨"], ["pisou numa bomba esquecida na mina", "💣"],
    ["acertou a picareta no próprio pé", "⛏️"], ["respirou gás da caverna e desmaiou", "☁️"], ["caiu num buraco escuro da mina", "🕳️"]] }
};
const dicaJogo = (m, cmd, p) => (ehVipConta(m) && (cmd === "cacar" || cmd === "minerar") ? `\n🎮 Enquanto espera: *${p}jogar ${cmd === "cacar" ? "caca" : "mina"}* (${cmd === "cacar" ? "Caçada" : "Mina da Hina"} no celular)` : "");
function sortearRaridade() { let r = aleatorio() * 100; for (const [nome, p, cor] of RARIDADE) { if ((r -= p) < 0) return { nome, cor }; } return { nome: "comum", cor: "⚪" }; }
for (const [cmd, cfg] of Object.entries(COLETAS)) {
  def(cmd === "cacar" ? ["cacar", "caçar", "cacada"] : cmd === "pescar" ? ["pescar", "pesca"] : ["minerar", "mineracao"], G, async (c) => {
    if (!exigir(c)) return;
    const m = conta(c.jid, c.autorJid);
    m.esperas ||= {};
    const verboInf = cmd === "cacar" ? "caçar" : cmd;
    const hosp = m.hospital?.[cmd];
    if (hosp && hosp.ate > Date.now()) return c.responder(`🏥 Você ainda está se recuperando: ${hosp.motivo}. Pode ${verboInf} de novo em *${espera(hosp.ate - Date.now())}*.\n💊 Para sair agora, pague os remédios por fora: *${c.prefixo}alta* (${moedas(precoAlta(hosp.ate - Date.now()))}).${dicaJogo(m, cmd, c.prefixo)}`);
    const falta = cfg.espera - (Date.now() - (m.esperas[cmd] || 0));
    if (falta > 0) return c.responder(`⏳ Descansando... pode ${verboInf} de novo em *${espera(falta)}*.${dicaJogo(m, cmd, c.prefixo)}`);
    m.esperas[cmd] = Date.now();
    marcar(c.jid);
    const ac = ACIDENTES[cmd];
    if (ac && chance(ac.chance)) {
      const [frase, emoji] = aleatorioDe(ac.frases);
      const horas = sorteio(ac.horas[0], ac.horas[1]);
      (m.hospital ||= {})[cmd] = { ate: Date.now() + horas * HORA, motivo: `${frase} ${emoji}` };
      const conta = sorteio(REMEDIO[0], REMEDIO[1]);
      const { pago, usados, troco } = pagarComMochila(m, conta);
      const lista = Object.entries(usados).map(([n, q]) => `${q}× ${PRECO_COLETA[n]?.e || "•"} ${n}`).join(", ");
      const remedio = pago >= conta ? `💊 Remédios: *${moedas(conta)}*, pagos com itens da mochila: ${lista}.${troco ? ` Troco de ${moedas(troco)} na mão.` : ""}`
        : pago > 0 ? `💊 Remédios: *${moedas(conta)}*. A mochila pagou ${moedas(Math.min(pago, conta))} (${lista}) e o hospital da Hina cobriu o resto.`
        : `💊 Remédios: *${moedas(conta)}*. Sua mochila estava vazia, então o hospital da Hina cobriu tudo.`;
      return c.responder(`🚑 *ACIDENTE ${ac.local.toUpperCase()}!*\n\n${marca(c.autorJid)} ${frase} ${emoji}\n\n🏥 Vai ficar *${horas} h* no hospital sem ${verboInf}.\n${remedio}\n_A carteira e o banco não são descontados._\n\n💊 Quer sair antes? *${c.prefixo}alta* — remédios por fora por ${moedas(precoAlta(horas * HORA))}.`, [c.autorJid]);
    }
    progresso(c, "coleta");
    if (chance(CHANCE_NADA)) return c.responder(`${cfg.titulo}\n\n${marca(c.autorJid)} ${cfg.verbo}... ${aleatorioDe(cfg.nada)}. Fica pra próxima! 😅`, [c.autorJid]);
    const rar = sortearRaridade();
    const [nome, emoji, preco] = aleatorioDe(cfg.itens[rar.nome]);
    m.mochila ||= {};
    m.mochila[nome] = (m.mochila[nome] || 0) + 1;
    m.coletas = (m.coletas || 0) + 1;
    const grito = rar.nome === "lendário" ? "\n\n🌟 *LENDÁRIO!!!* Que sorte absurda! 🌟" : rar.nome === "épico" ? "\n\n🎉 *Épico!*" : "";
    return c.responder(`${cfg.titulo}\n\n${marca(c.autorJid)} ${cfg.verbo} ${emoji} *${nome}*!\n${rar.cor} Raridade: *${rar.nome}* · vale ${moedas(precoItem(nome, m))}${grito}\n\n_Guardado na mochila. Venda com ${c.prefixo}vendercoleta._`, [c.autorJid]);
  });
}
def(["alta", "hospital", "remedios", "remédios"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const agora = Date.now();
  const internado = Object.entries(m.hospital || {}).filter(([, h]) => h?.ate > agora).sort((a, b) => b[1].ate - a[1].ate);
  if (!internado.length) return c.responder("🏥 Você não está no hospital. Tudo certo por aí! 💪");
  const [arg1, arg2] = c.args.map((a) => String(a).toLowerCase().replace("ç", "c"));
  const qual = ["cacar", "minerar"].includes(arg1) ? arg1 : ["cacar", "minerar"].includes(arg2) ? arg2 : internado[0][0];
  const h = m.hospital[qual];
  if (!h || h.ate <= agora) return c.responder(`Você não está no hospital por ${qual === "cacar" ? "caça" : "mineração"}.`);
  const preco = precoAlta(h.ate - agora);
  const pagar = [arg1, arg2].includes("pagar") || [arg1, arg2].includes("sim");
  if (!pagar) {
    return c.responder(`🏥 *HOSPITAL DA HINA*\n\n${internado.map(([k, x]) => `• ${x.motivo}\n   sem ${NOME_COLETA[k] || k} por mais *${espera(x.ate - agora)}* · alta: ${moedas(precoAlta(x.ate - agora))}`).join("\n")}\n\n` +
      `💊 Para sair agora, pague os remédios por fora (sai da mão):\n*${c.prefixo}alta pagar${internado.length > 1 ? ` ${qual}` : ""}* — ${moedas(preco)}\n_O preço cai conforme o tempo passa (de ${moedas(ALTA_MIN)} a ${moedas(ALTA_MAX)})._`);
  }
  if (m.carteira < preco) return c.responder(`💊 Os remédios custam ${moedas(preco)} e você tem ${moedas(m.carteira)} na mão.${m.banco >= preco ? ` Saque do banco com *${c.prefixo}sacar ${preco}* e tente de novo.` : " Espere a alta normal ou junte mais moedas."}`);
  m.carteira -= preco;
  delete m.hospital[qual];
  marcar(c.jid);
  return c.responder(`💊 ${marca(c.autorJid)} pagou *${moedas(preco)}* em remédios e recebeu alta! Já pode ${NOME_COLETA[qual] || qual} de novo. 🏃`, [c.autorJid]);
});
const PRECO_COLETA = Object.fromEntries(Object.values(COLETAS).flatMap((x) => Object.entries(x.itens).flatMap(([rar, l]) => l.map(([n, e, p]) => [n, { e, p, rar }]))));
const precoItem = (n, m = null) => (PRECO_COLETA[n] ? ganho("coletas", PRECO_COLETA[n].p, m) : 0);
def(["mochila", "inventario", "inventário"], G, async (c) => {
  if (!exigir(c)) return;
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const itens = Object.entries(m.mochila || {}).filter(([, q]) => q > 0).sort((a, b) => precoItem(b[0], m) - precoItem(a[0], m));
  if (!itens.length) return c.responder(`🎒 Mochila vazia. Tente *${c.prefixo}pescar*, *${c.prefixo}minerar* ou *${c.prefixo}cacar*!`);
  let total = 0;
  const linhas = itens.map(([n, q]) => { const x = PRECO_COLETA[n] || { e: "•", rar: "?" }; const pr = precoItem(n, m); total += pr * q; return `${x.e} *${n}* ×${q} · ${x.rar} · ${moedas(pr * q)}`; });
  return c.responder(`🎒 *MOCHILA* — ${marca(alvo)}\n\n${linhas.join("\n")}\n\n💰 Vale tudo: *${moedas(total)}*\n🎯 Coletas feitas: ${fmt(m.coletas || 0)}\n_${c.prefixo}vendercoleta tudo · ${c.prefixo}vendercoleta salmão_`, [alvo]);
});
def(["vendercoleta", "venderitens", "vendermochila"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const alvoItem = c.args.join(" ").toLowerCase().trim();
  const todos = !alvoItem || alvoItem === "tudo";
  const itens = Object.entries(m.mochila || {}).filter(([n, q]) => q > 0 && (todos || n === alvoItem));
  if (!itens.length) return c.responder(todos ? "🎒 Nada para vender." : `Você não tem *${alvoItem}* na mochila. Veja em *${c.prefixo}mochila*.`);
  let total = 0, qtd = 0;
  for (const [n, q] of itens) { total += precoItem(n, m) * q; qtd += q; delete m.mochila[n]; }
  m.carteira += total;
  marcar(c.jid);
  progresso(c, "vender");
  return c.responder(`🤝 Vendeu ${qtd} item(ns) da mochila por *${moedas(total)}*.\n👛 Na mão: ${moedas(m.carteira)}`);
});

const hojeBr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const semAcentoE = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const embaralharE = (p) => { const l = p.split(""); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(aleatorio() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } const r = l.join(""); return r === p ? embaralharE(p) : r; };

const MISSOES = {
  trabalhar: { alvo: 3, txt: "Trabalhe 3 vezes", cmd: "trabalhar" },
  coleta: { alvo: 4, txt: "Faça 4 coletas (pescar, minerar ou caçar)", cmd: "minerar" },
  desafio: { alvo: 2, txt: "Acerte 2 desafios", cmd: "desafio" },
  jogo: { alvo: 1, txt: "Vença 1 jogo do grupo (forca, quiz, anagrama…)", cmd: "quiz" },
  diario: { alvo: 1, txt: "Pegue o diário", cmd: "diario" },
  vender: { alvo: 1, txt: "Venda itens da mochila", cmd: "vendercoleta" }
};
const BAU_MISSOES = 676;
function missoesDe(m) {
  const dia = hojeBr();
  if (m.missoes?.dia === dia) return m.missoes;
  const ids = embaralhar(Object.keys(MISSOES)).slice(0, 3);
  m.missoes = { dia, lista: ids.map((id) => ({ id, feito: 0, pago: false, premio: sorteio(270, 540) })), bau: false };
  return m.missoes;
}
const PONTOS_META = { jogo: 2 };
function metaDe(jid, meta = null) {
  const d = dados(jid);
  const dia = hojeBr();
  if (d.meta?.dia !== dia) {
    const n = meta?.participants?.length || d.presentes.length || 20;
    d.meta = { dia, alvo: Math.min(80, Math.max(20, Math.round(n * 0.6))), pontos: 0, contrib: {}, batida: false };
    marcar(jid);
  }
  return d.meta;
}
function progresso(c, tipo) {
  try {
    const m = conta(c.jid, c.autorJid);
    for (const x of missoesDe(m).lista) if (x.id === tipo) x.feito += 1;
    if (ehGrupo(c.jid) && cfgRpg(c.jid).economia) {
      const mt = metaDe(c.jid, c.meta);
      if (!mt.batida) {
        const k = chave(c.jid, c.autorJid);
        const p = PONTOS_META[tipo] || 1;
        mt.pontos += p;
        mt.contrib[k] = (mt.contrib[k] || 0) + p;
        if (mt.pontos >= mt.alvo) { mt.batida = Date.now(); setImmediate(() => pagarMeta(c.jid, c.sock).catch(() => {})); }
      }
    }
    marcar(c.jid);
  } catch {}
}
async function pagarMeta(jid, sock) {
  if (tx) return void setTimeout(() => pagarMeta(jid, sock).catch(() => {}), 200);
  const mt = dados(jid).meta;
  if (!mt?.batida || mt.pago) return;
  mt.pago = true;
  const pagos = [];
  await emTransacao(jid, "meta do grupo", "sistema", async () => {
    for (const [k, n] of Object.entries(mt.contrib)) {
      const m = contasGlobais().membros[resolver(k)];
      if (!m || m.congelado) continue;
      const v = ganho("meta", 200 + 68 * n, m);
      conta(jid, k).carteira += v;
      pagos.push([k, n, v]);
    }
  });
  marcar(jid);
  cobrarAtrasados();
  if (!pagos.length || !(sock || atualSock)) return;
  pagos.sort((a, b) => b[1] - a[1]);
  const linhas = pagos.slice(0, 25).map(([k, n, v]) => `• ${mk(jid, k)} — ${n} ponto(s) · *+${moedas(v)}*`);
  await (sock || atualSock).sendMessage(jid, { text: `🎯 *META DO GRUPO BATIDA!* 🎉\n\nO grupo juntou *${mt.pontos}/${mt.alvo}* pontos hoje. Todo mundo que ajudou ganhou:\n\n${linhas.join("\n")}${pagos.length > 25 ? `\n…e mais ${pagos.length - 25}` : ""}\n\n_Amanhã tem meta nova. Veja com !metagrupo._`, mentions: pagos.map(([k]) => jidDe(jid, k)) }).catch(() => {});
}
let atualSock = null;

const PREMIO_JOGO = { quiz: [100, 200], "qual é o animal": [135, 270], velha: [135, 270], anagrama: [200, 400], digitar: [200, 475], gartic: [270, 540], forca: [270, 540] };
const JOGOS_DIA = 15;
export async function premiarJogo(c, partida) {
  if (!partida || !c?.jid || !ehGrupo(c.jid)) return 0;
  const faixa = PREMIO_JOGO[partida.tipo];
  if (!faixa || !cfgRpg(c.jid).economia) return 0;
  if (c.sock) atualSock = c.sock;
  let v = 0, n = 0;
  await emTransacao(c.jid, `jogo ${partida.tipo}`.slice(0, 24), "sistema", async () => {
    const m = conta(c.jid, c.autorJid);
    darInicial(c.jid, m);
    if (m.congelado) return;
    const dia = hojeBr();
    if (m.jogosHoje?.dia !== dia) m.jogosHoje = { dia, n: 0 };
    if (m.jogosHoje.n >= JOGOS_DIA) return;
    const rapidez = partida.tipo === "digitar" && partida.inicio ? Math.max(0, Math.min(1, 1 - ((Date.now() - partida.inicio) / 1000 - 20) / 60)) : aleatorio();
    v = ganho("jogos", faixa[0] + (faixa[1] - faixa[0]) * rapidez, m);
    m.carteira += v;
    n = ++m.jogosHoje.n;
    marcar(c.jid);
  });
  cobrarAtrasados();
  if (!v) return 0;
  progresso(c, "jogo");
  await c.responder?.(`🪙 ${marca(c.autorJid)} levou *+${moedas(v)}* pela vitória! _(${n}/${JOGOS_DIA} prêmios de jogo hoje)_`, [c.autorJid]);
  return v;
}

const PALAVRAS_MEDIO = ["CANETA", "JANELA", "BANANA", "CADEIRA", "PIRATA", "TOMATE", "GALINHA", "PANELA", "ESCOLA", "FOGUETE", "MOCHILA", "PIPOCA", "SAPATO", "LIMÃO", "CAMELO"];
const PALAVRAS_DIFICIL = ["BORBOLETA", "COMPUTADOR", "ELEFANTE", "TARTARUGA", "GELADEIRA", "HELICOPTERO", "DINOSSAURO", "CHOCOLATE", "TRAVESSEIRO", "ABACATEIRO", "CALENDARIO", "BIBLIOTECA", "ASTRONAUTA", "MARACUJA"];
const DESAFIOS = {
  facil: { nome: "FÁCIL", emoji: "🟢", tempo: 30, premio: [60, 170], espera: 3 * MIN },
  medio: { nome: "MÉDIO", emoji: "🟡", tempo: 45, premio: [200, 370], espera: 8 * MIN },
  dificil: { nome: "DIFÍCIL", emoji: "🔴", tempo: 60, premio: [400, 676], espera: 15 * MIN }
};
const NIVEL_DESAFIO = { facil: "facil", "fácil": "facil", f: "facil", 1: "facil", medio: "medio", "médio": "medio", m: "medio", 2: "medio", dificil: "dificil", "difícil": "dificil", d: "dificil", 3: "dificil" };
function gerarDesafio(nivel) {
  if (nivel === "facil") {
    const a = sorteio(12, 99), b = sorteio(11, 89);
    return chance(0.5) ? { pergunta: `Quanto é *${a} + ${b}*?`, resposta: String(a + b) } : { pergunta: `Quanto é *${Math.max(a, b)} − ${Math.min(a, b)}*?`, resposta: String(Math.max(a, b) - Math.min(a, b)) };
  }
  if (nivel === "medio") {
    if (chance(0.5)) { const a = sorteio(3, 12), b = sorteio(11, 25); return { pergunta: `Quanto é *${a} × ${b}*?`, resposta: String(a * b) }; }
    const p = semAcentoE(aleatorioDe(PALAVRAS_MEDIO));
    return { pergunta: `Desembaralhe a palavra: *${embaralharE(p)}*`, resposta: p };
  }
  const tipo = sorteio(1, 3);
  if (tipo === 1) { const a = sorteio(6, 19), b = sorteio(6, 19), c = sorteio(10, 99), d = sorteio(10, 60); return { pergunta: `Quanto é *(${a} × ${b}) + ${c} − ${d}*?`, resposta: String(a * b + c - d) }; }
  if (tipo === 2) { const ini = sorteio(2, 9), r = sorteio(3, 9); const s = [0, 1, 2, 3].map((i) => ini + r * i * (i + 1) / 2); return { pergunta: `Qual o próximo número? *${s.join(", ")}, ?*\n_(dica: a diferença cresce sempre do mesmo jeito)_`, resposta: String(ini + r * 10) }; }
  const p = semAcentoE(aleatorioDe(PALAVRAS_DIFICIL));
  return { pergunta: `Desembaralhe a palavra: *${embaralharE(p)}*`, resposta: p };
}
def(["desafio", "desafios", "dsf"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const p = c.prefixo;
  const nivel = NIVEL_DESAFIO[String(c.args[0] || "").toLowerCase()];
  const aberto = m.desafio && m.desafio.ate > Date.now() ? m.desafio : null;
  if (!nivel) {
    const pronto = (m.desafioLivre || 0) <= Date.now();
    return c.responder(`🎯 *DESAFIOS DA HINA* — sem aposta, só cabeça!\n\n` +
      Object.entries(DESAFIOS).map(([k, d]) => `${d.emoji} *${p}desafio ${k === "facil" ? "fácil" : k === "medio" ? "médio" : "difícil"}* — ${moedas(ganho("desafios", d.premio[0], m))} a ${moedas(ganho("desafios", d.premio[1], m))} · ${d.tempo}s para responder · próximo em ${espera(d.espera)}`).join("\n") +
      `\n\n✍️ Responda com *${p}r sua resposta*\n⚡ Quanto mais rápido, mais perto do prêmio máximo.\n❌ Errou ou perdeu o tempo? Não perde nada, só espera o próximo.\n\n${aberto ? `⏳ Você tem um desafio aberto: ${aberto.pergunta}` : pronto ? "✅ Você já pode jogar." : `⏳ Próximo desafio em *${espera(m.desafioLivre - Date.now())}*.`}`);
  }
  if (aberto) return c.responder(`⏳ Termine o desafio aberto primeiro:\n\n${aberto.pergunta}\n\n✍️ *${p}r sua resposta* (faltam ${Math.ceil((aberto.ate - Date.now()) / 1000)}s)`);
  if ((m.desafioLivre || 0) > Date.now()) return c.responder(`⏳ Respira! Próximo desafio em *${espera(m.desafioLivre - Date.now())}*.`);
  const d = DESAFIOS[nivel];
  const g = gerarDesafio(nivel);
  m.desafio = { nivel, pergunta: g.pergunta, resposta: g.resposta, desde: Date.now(), ate: Date.now() + d.tempo * 1000 };
  m.desafioLivre = Date.now() + d.espera;
  marcar(c.jid);
  return c.responder(`${d.emoji} *DESAFIO ${d.nome}* — ${marca(c.autorJid)}\n\n${g.pergunta}\n\n⏱️ *${d.tempo} segundos* · prêmio de ${moedas(ganho("desafios", d.premio[0], m))} a ${moedas(ganho("desafios", d.premio[1], m))}\n✍️ Responda: *${p}r sua resposta*`, [c.autorJid]);
});
def(["r", "resposta", "resp"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const x = m.desafio;
  if (!x) return c.responder(`Você não tem desafio aberto. Comece com *${c.prefixo}desafio fácil*, *médio* ou *difícil*.`);
  const d = DESAFIOS[x.nivel];
  delete m.desafio;
  marcar(c.jid);
  const chute = semAcentoE(c.args.join(" ")).replace(/\s+/g, "");
  if (!chute) { m.desafio = x; return c.responder(`Mande a resposta junto: *${c.prefixo}r 42*`); }
  if (Date.now() > x.ate) return c.responder(`⌛ O tempo acabou! A resposta era *${x.resposta}*.\n_Sem problema: nada foi descontado._`);
  if (chute !== semAcentoE(x.resposta)) return c.responder(`❌ Não foi dessa vez, ${marca(c.autorJid)}. A resposta era *${x.resposta}*.\n_Nada foi descontado. Tente de novo em ${espera(Math.max(0, m.desafioLivre - Date.now()))}._`, [c.autorJid]);
  const rapidez = Math.max(0, Math.min(1, 1 - (Date.now() - x.desde) / (d.tempo * 1000)));
  const v = ganho("desafios", d.premio[0] + (d.premio[1] - d.premio[0]) * rapidez, m);
  m.carteira += v;
  m.desafiosAcertados = (m.desafiosAcertados || 0) + 1;
  marcar(c.jid);
  progresso(c, "desafio");
  const seg = ((Date.now() - x.desde) / 1000).toFixed(1);
  return c.responder(`✅ *ACERTOU!* ${marca(c.autorJid)} respondeu *${x.resposta}* em ${seg}s.\n💰 *+${moedas(v)}* ${d.emoji}\n\n🎯 Desafios acertados: ${fmt(m.desafiosAcertados)}`, [c.autorJid]);
});

def(["missoes", "missões", "missao", "missão"], G, async (c) => {
  if (!exigir(c)) return;
  const m = conta(c.jid, c.autorJid);
  const ms = missoesDe(m);
  const pagos = [];
  for (const x of ms.lista) {
    if (x.pago || x.feito < MISSOES[x.id].alvo) continue;
    x.pago = true;
    const v = ganho("missoes", x.premio, m);
    m.carteira += v;
    pagos.push(`✅ ${MISSOES[x.id].txt}: *+${moedas(v)}*`);
  }
  if (!ms.bau && ms.lista.every((x) => x.pago)) { ms.bau = true; const bau = ganho("missoes", BAU_MISSOES, m); m.carteira += bau; pagos.push(`🎁 *Baú das 3 missões:* *+${moedas(bau)}*`); }
  marcar(c.jid);
  const linhas = ms.lista.map((x) => { const q = MISSOES[x.id]; const n = Math.min(x.feito, q.alvo); return `${x.pago ? "✅" : n >= q.alvo ? "🎉" : "▫️"} ${q.txt} — ${n}/${q.alvo} · ${moedas(ganho("missoes", x.premio, m))}${x.pago ? "" : `\n     ↳ ${c.prefixo}${q.cmd}`}`; });
  return c.responder(`📜 *MISSÕES DE HOJE* — ${marca(c.autorJid)}\n\n${linhas.join("\n")}\n${ms.bau ? "🎁 Baú aberto hoje ✅" : `🎁 Complete as 3: baú de ${moedas(ganho("missoes", BAU_MISSOES, m))}`}` +
    `${pagos.length ? `\n\n💰 *Recebido agora:*\n${pagos.join("\n")}` : ""}\n\n_Missões novas todo dia à meia-noite. Use ${c.prefixo}missoes para receber as que terminar._`, [c.autorJid]);
});

def(["metagrupo", "metadogrupo", "meta"], G, async (c) => {
  if (!exigir(c)) return;
  if (c.sock) atualSock = c.sock;
  const mt = metaDe(c.jid, c.meta);
  const pct = Math.min(100, Math.floor((mt.pontos / mt.alvo) * 100));
  const barra = "🟩".repeat(Math.floor(pct / 10)) + "⬜".repeat(10 - Math.floor(pct / 10));
  const top = Object.entries(mt.contrib).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const eu = mt.contrib[chave(c.jid, c.autorJid)] || 0;
  return c.responder(`🎯 *META DO GRUPO — HOJE*\n\n${barra} ${pct}%\n*${Math.min(mt.pontos, mt.alvo)}/${mt.alvo}* pontos${mt.batida ? " · ✅ *batida!*" : ""}\n\n` +
    `➕ Cada trabalho, coleta, diário e desafio acertado vale 1 ponto; vencer jogo do grupo vale 2.\n🎁 Quando o grupo bate, todo mundo que ajudou ganha de ${moedas(ganho("meta", 268))} a ${moedas(ganho("meta", 676))} (mais pontos, mais prêmio).\n\n` +
    `${top.length ? `🏅 *Quem mais ajudou:*\n${top.map(([k, n], i) => `${i + 1}. ${mk(c.jid, k)} — ${n}`).join("\n")}\n\n` : ""}👤 Você: *${eu}* ponto(s)`, top.map(([k]) => jidDe(c.jid, k)));
});

const fonteDe = (txt) => Object.keys(FONTES_GANHO).find((f) => FONTES_GANHO[f].nomes.includes(String(txt || "").toLowerCase()));
const escalar = (f, fator) => FONTES_GANHO[f].base.map((x) => Math.min(LIMITE_MAX, Math.max(1, Math.round(x * fator))));
def(["limiteganho", "limiteganhos", "limitesganho", "limganho"], { dono: true }, async (c) => {
  const p = c.prefixo;
  const alvo = c.args.some((a) => a.startsWith("@")) ? alvoMarcado(c) : null;
  const m = alvo ? conta(c.jid, alvo) : null;
  const L = limites();
  const termos = valoresDe(c).map((x) => x.toLowerCase());
  const [acao] = termos;
  const quem = alvo ? ` para ${marca(alvo)}` : "";
  const ment = alvo ? [alvo] : [];
  const linha = (f) => {
    const [a, b] = faixaGanho(f, m);
    const [b0, b1] = FONTES_GANHO[f].base;
    const proprio = m && faixaOk(m.limites?.[f]);
    return `${FONTES_GANHO[f].nome}: *${moedas(a)}* a *${moedas(b)}*${proprio ? " 👤" : a !== b0 || b !== b1 ? " ✏️" : ""}`;
  };
  const tabela = () => Object.keys(FONTES_GANHO).map(linha).join("\n");
  const gravar = (mudancas, txt) => {
    for (const [f, faixa] of Object.entries(mudancas)) {
      const igualBase = faixa && faixa[0] === FONTES_GANHO[f].base[0] && faixa[1] === FONTES_GANHO[f].base[1];
      if (m) { m.limites ||= {}; if (faixa && (!igualBase || faixaOk(L.fontes[f]))) m.limites[f] = faixa; else delete m.limites[f]; if (!Object.keys(m.limites).length) delete m.limites; }
      else if (faixa && !igualBase) L.fontes[f] = faixa; else delete L.fontes[f];
    }
    L.hist.push({ t: Date.now(), por: usuario(c.autorJid), alvo: alvo ? chave(c.jid, alvo) : null, txt: String(txt).slice(0, 80) });
    if (L.hist.length > 30) L.hist.splice(0, L.hist.length - 30);
    salvarLimites();
    if (m) marcar(c.jid);
  };
  const lerNum = (x) => { const v = lerValor(x, 0); return Number.isFinite(v) && v > 0 ? Math.floor(v) : NaN; };
  const faixaNova = (f, nums) => {
    if (nums.length >= 2) { const [x, y] = nums; return [Math.min(x, y), Math.max(x, y)]; }
    const [a] = faixaGanho(f, m);
    return [Math.min(a, nums[0]), nums[0]];
  };

  if (!acao) {
    const pessoas = Object.values(contasGlobais().membros || {}).filter((x) => x?.limites && Object.keys(x.limites).length).length;
    const ult = L.hist[L.hist.length - 1];
    return c.responder(`📏 *LIMITES DOS GANHOS GRÁTIS*${quem}\n\n${tabela()}\n\n✏️ = mudado por você${m ? " · 👤 = só desta pessoa" : ""}\n${pessoas ? `👤 ${pessoas} pessoa(s) com limite próprio\n` : ""}${ult ? `🕓 Última mudança: ${new Date(ult.t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — ${ult.txt}\n` : ""}\n` +
      `*Como mudar:*\n• *${p}limiteganho trabalhar 1 1000* — só um comando\n• *${p}limiteganho crime 900* — só o máximo\n• *${p}limiteganho todos 50 900* — todos com a mesma faixa\n• *${p}limiteganho universal 1000* (ou *150%*) — reescala tudo junto, mantendo a diferença entre os comandos\n• *${p}limiteganho resetar* (ou *resetar crime*) — volta ao original\n• Acrescente *@fulano* para valer só para uma pessoa\n\n_Comandos: ${Object.keys(FONTES_GANHO).join(", ")}. Vale na hora, em todos os grupos desta Hina. Não mexe em quem já ganhou._`, ment);
  }

  if (["resetar", "reset", "padrao", "padrão", "original"].includes(acao)) {
    const qual = termos[1] && !["todos", "tudo"].includes(termos[1]) ? fonteDe(termos[1]) : null;
    if (termos[1] && !["todos", "tudo"].includes(termos[1]) && !qual) return c.responder(`Não conheço o comando *${termos[1]}*. Use um destes: ${Object.keys(FONTES_GANHO).join(", ")}.`);
    const alvos2 = qual ? [qual] : Object.keys(FONTES_GANHO);
    if (m) { for (const f of alvos2) delete m.limites?.[f]; if (m.limites && !Object.keys(m.limites).length) delete m.limites; marcar(c.jid); L.hist.push({ t: Date.now(), por: usuario(c.autorJid), alvo: chave(c.jid, alvo), txt: `resetar ${qual || "todos"} (pessoa)` }); salvarLimites(); }
    else gravar(Object.fromEntries(alvos2.map((f) => [f, null])), `resetar ${qual || "todos"}`);
    return c.responder(`↩️ ${qual ? FONTES_GANHO[qual].nome : "Todos os ganhos"} de volta ${m ? "ao limite geral" : "ao original"}${quem}.\n\n${tabela()}`, ment);
  }

  if (acao === "universal") {
    const txt = termos[1] || "";
    const pct = /^(\d+(?:[.,]\d+)?)%$/.exec(txt);
    const fator = pct ? Number(pct[1].replace(",", ".")) / 100 : lerNum(txt) / GRATIS_TETO;
    if (!(fator > 0)) return c.responder(`Diga o novo máximo geral: *${p}limiteganho universal 1000* (o que pagava até ${moedas(GRATIS_TETO)} passa a pagar até ${moedas(1000)}, e o resto acompanha) ou em porcentagem: *${p}limiteganho universal 150%*.`);
    if (GRATIS_TETO * fator > LIMITE_MAX) return c.responder(`O máximo por ganho é ${moedas(LIMITE_MAX)}.`);
    gravar(Object.fromEntries(Object.keys(FONTES_GANHO).map((f) => [f, escalar(f, fator)])), `universal ${pct ? pct[0] : fmt(lerNum(txt))}`);
    return c.responder(`🌐 *Limite universal aplicado*${quem}: ${pct ? pct[0] : `máximo de ${moedas(lerNum(txt))}`} (${Math.round(fator * 100)}% das faixas originais).\n\n${tabela()}\n\n_Todos os comandos mudaram juntos. Para ajustar um só depois: ${p}limiteganho crime 900._`, ment);
  }

  const todos = ["todos", "tudo", "geral"].includes(acao);
  const fonte = todos ? null : fonteDe(acao);
  if (!todos && !fonte) return c.responder(`Não conheço o comando *${acao}*. Use um destes: ${Object.keys(FONTES_GANHO).join(", ")} (ou *todos*, *universal*, *resetar*).\nVeja tudo com *${p}limiteganho*.`);
  const nums = termos.slice(1).map(lerNum);
  if (!nums.length || nums.some((x) => !Number.isFinite(x))) return c.responder(`Diga a faixa: *${p}limiteganho ${acao} 1 1000* (mínimo e máximo) ou só o máximo: *${p}limiteganho ${acao} 1000*.`);
  if (Math.max(...nums) > LIMITE_MAX) return c.responder(`O máximo por ganho é ${moedas(LIMITE_MAX)}.`);
  const alvosF = todos ? Object.keys(FONTES_GANHO) : [fonte];
  gravar(Object.fromEntries(alvosF.map((f) => [f, faixaNova(f, nums.slice(0, 2))])), `${todos ? "todos" : fonte} ${nums.slice(0, 2).map(fmt).join("–")}`);
  return c.responder(`✅ Limite atualizado${quem}:\n\n${todos ? tabela() : linha(fonte)}\n\n_Vale na hora, em todos os grupos desta Hina. Ver tudo: ${p}limiteganho_`, ment);
});

def(["comoganhar", "ganhar", "ganhos"], G, async (c) => {
  if (!exigir(c)) return;
  const p = c.prefixo;
  return c.responder(`💡 *COMO GANHAR MOEDAS* (sem apostar nada)\n\n` +
    `🎁 *${p}diario* — todo dia, sobe com a sequência\n💼 *${p}trabalhar* — a cada 20 min\n⛏️ *${p}minerar* (5 min) · 🏹 *${p}cacar* (10 min) · 🎣 *${p}pescar* (1 h) → venda com *${p}vendercoleta*\n` +
    `🎯 *${p}desafio fácil/médio/difícil* — conta ou palavra; mais difícil, mais paga\n🎮 *${p}forca · ${p}quiz · ${p}anagrama · ${p}digitar* — quem vence leva moedas\n` +
    `📜 *${p}missoes* — 3 por dia + baú de ${moedas(ganho("missoes", BAU_MISSOES))}\n🎯 *${p}metagrupo* — meta coletiva: todo mundo que ajuda ganha\n🏅 *${p}conquistas* — metas com prêmio\n🏘️ *${p}loja* — propriedades que rendem por hora\n🐷 *${p}poupanca* · 🏛️ *${p}cdb* — rendem sem risco\n\n` +
    `_Dica: faça as missões enquanto ajuda a meta do grupo. Tudo conta junto!_`);
});

def(["rankrico", "toprico", "ricos", "rankeco"], G, async (c) => {
  if (!exigir(c)) return;
  const d = dados(c.jid);
  const lista = contasDoGrupo(c.jid, c.meta).map(([n, m]) => [n, patrimonio(m)]).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  if (!lista.length) return c.responder(`Ninguém tem moedas ainda. Comece com *${c.prefixo}diario* e *${c.prefixo}trabalhar*!`);
  const medalhas = ["🥇", "🥈", "🥉"];
  const top = lista.slice(0, 10);
  const minhaPos = lista.findIndex(([n]) => n === chave(c.jid, c.autorJid));
  const total = lista.reduce((s, [, p]) => s + p, 0);
  const podio = top.slice(0, 3).map(([n, p], i) => `${["👑", "💎", "🥉"][i]} *${["1º · O MAIS RICO", "2º · VICE-MILIONÁRIO", "3º · TERCEIRA FORTUNA"][i]}*\n   ${mk(c.jid, n)}${selo(c.jid, n)} — ${moedas(p)}\n   ${tituloDe(d.membros[n])}`).join("\n");
  const resto = top.slice(3).map(([n, p], i) => `${i + 4}. ${mk(c.jid, n)}${selo(c.jid, n)} — ${moedas(p)}`).join("\n");
  return c.responder(`💎 *MAIS RICOS DO GRUPO*\n\n👑═══════ ✠ ═══════👑\n${podio}\n👑═══════ ✠ ═══════👑${resto ? `\n\n${resto}` : ""}\n\n` +
    `🏦 Economia do grupo: *${moedas(total)}* (${lista.length} jogadores)${minhaPos >= 10 ? `\n📍 Você: ${minhaPos + 1}º` : ""}\n_Ranking entre grupos: ${c.prefixo}rankgrupos_`, top.map(([n]) => jidDe(c.jid, n)));
});

const brData = (ms) => new Date(ms).toLocaleDateString("pt-BR");
const brDataHora = (ms) => new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const avisosVip = [];

def(["meuvip", "vipstatus", "statusvip"], {}, async (c) => {
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const p = c.prefixo;
  if (!ehVipConta(m)) return c.responder(`${alvo === c.autorJid ? "Você" : marca(alvo)} não é VIP no momento.\n\n💎 Vire VIP com *${p}vip* — lembretes, selo 💎, moldura e título exclusivos, em todos os grupos da Hina.`, alvo === c.autorJid ? [] : [alvo]);
  const falta = m.vip.ate - Date.now();
  const dias = Math.floor(falta / DIA_MS), horas = Math.floor((falta % DIA_MS) / 3600000);
  return c.responder(`💎 *VIP ATIVO* — ${marca(alvo)}\n\n📅 Vale até *${brDataHora(m.vip.ate)}*\n⏳ Faltam *${dias > 0 ? `${dias} dia(s)` : `${horas} h`}*\n🎁 Desde ${brData(m.vip.desde)}${m.vip.origem === "dono" ? " (cortesia do dono)" : ""}\n\nVantagens: ${p}lembrete · selo 💎 · ${p}molduras usar diamante · ${p}titulos usar vip\nRenovar: *${p}vip*`, [alvo]);
});

const LEMBRETE_MAX = 10, LEMBRETE_MAX_MS = 30 * DIA_MS;
const lembretesDe = () => (contasGlobais().lembretes ||= []);
function lerTempo(txt) {
  const m = /^(\d+)\s*(min|m|h|hora|horas|d|dia|dias)$/i.exec(String(txt || "").trim());
  if (!m) return NaN;
  const n = Number(m[1]); const u = m[2].toLowerCase();
  const mult = u.startsWith("h") ? 3600000 : u.startsWith("d") ? DIA_MS : 60000;
  return n * mult;
}
def(["lembrete", "lembrar", "reembretar"], { grupo: true, vip: true }, async (c) => {
  const m = conta(c.jid, c.autorJid);
  if (!ehVipConta(m)) return c.responder(`⏰ Os lembretes são para VIP. Vire VIP com *${c.prefixo}vip* e eu te aviso na hora que você marcar. 💎`);
  const tempo = lerTempo(c.args[0]);
  const texto = c.args.slice(1).join(" ").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  if (!(tempo > 0) || !texto) return c.responder(`⏰ Use: *${c.prefixo}lembrete 30m Beber água*\n_(tempo: 30m, 2h ou 1d · até 30 dias)_`);
  if (tempo > LEMBRETE_MAX_MS) return c.responder("⏰ O lembrete pode ser de no máximo 30 dias.");
  const k = chave(c.jid, c.autorJid);
  const lista = lembretesDe();
  if (lista.filter((l) => l.k === k).length >= LEMBRETE_MAX) return c.responder(`⏰ Você já tem ${LEMBRETE_MAX} lembretes. Veja com *${c.prefixo}lembretes* e cancele algum.`);
  const id = crypto.randomBytes(3).toString("hex");
  lista.push({ id, k, jid: c.isGroup ? c.jid : jidDe(c.jid, k), privado: !c.isGroup, texto, quando: Date.now() + tempo, criadoEm: Date.now() });
  marcar(c.jid);
  return c.responder(`⏰ Combinado! Vou te lembrar em *${espera(tempo)}*:\n_"${texto}"_\n\nCódigo: *${id}* (cancele com ${c.prefixo}cancelarlembrete ${id})`, [c.autorJid]);
});
def(["lembretes", "meuslembretes"], { grupo: true, vip: true }, async (c) => {
  const k = chave(c.jid, c.autorJid);
  const meus = lembretesDe().filter((l) => l.k === k).sort((a, b) => a.quando - b.quando);
  if (!meus.length) return c.responder(`⏰ Você não tem lembretes. Crie com *${c.prefixo}lembrete 30m texto*.`);
  return c.responder(`⏰ *SEUS LEMBRETES*\n\n${meus.map((l) => `• *${l.id}* — em ${espera(l.quando - Date.now())}\n   _"${l.texto}"_`).join("\n")}\n\n_Cancelar: ${c.prefixo}cancelarlembrete <código>_`);
});
def(["cancelarlembrete", "dellembrete"], { grupo: true, vip: true }, async (c) => {
  const k = chave(c.jid, c.autorJid);
  const id = String(c.args[0] || "").toLowerCase();
  const lista = lembretesDe();
  const i = lista.findIndex((l) => l.k === k && l.id === id);
  if (i < 0) return c.responder(`Não achei esse lembrete. Veja os seus em *${c.prefixo}lembretes*.`);
  lista.splice(i, 1); marcar(c.jid);
  return c.responder("⏰ Lembrete cancelado.");
});

def(["addvip", "darvip", "setvip"], DONO_G, async (c) => {
  const alvo = alvoMarcado(c);
  const dias = Math.floor(Number(String(valoresDe(c)[0] || "").replace(/\D/g, "")));
  if (!alvo || !(dias > 0)) return c.responder(`Use: *${c.prefixo}addvip @fulano 7* (dias; cortesia, soma ao que já tiver)`);
  if (dias > 3650) return c.responder("No máximo 3650 dias por vez.");
  const ate = darVip(c.jid, jidDe(c.jid, chave(c.jid, alvo)), dias, "dono");
  logAdmin(c, "addvip", alvo, dias);
  return c.responder(`💎 ${marca(alvo)} agora é *VIP* por +${dias} dia(s).\n📅 Vale até ${brDataHora(ate)}.`, [alvo]);
});
def(["rmvip", "tirarvip", "removervip"], DONO_G, async (c) => {
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`Use: *${c.prefixo}rmvip @fulano*`);
  const tinha = tirarVip(c.jid, jidDe(c.jid, chave(c.jid, alvo)));
  logAdmin(c, "rmvip", alvo);
  return c.responder(tinha ? `💎 VIP de ${marca(alvo)} removido.` : `${marca(alvo)} não era VIP.`, [alvo]);
});
def(["listavip", "vips", "listvip"], EQUIPE_G, async (c) => {
  const g = contasGlobais();
  const agora = Date.now();
  const lista = Object.entries(g.membros).filter(([, m]) => m?.vip?.ate > agora).map(([k, m]) => [k, m.vip.ate]).sort((a, b) => a[1] - b[1]);
  if (!lista.length) return c.responder("💎 Não há VIPs ativos no momento.");
  return c.responder(`💎 *VIPs ATIVOS* (${lista.length})\n_A conta vale em todos os grupos desta Hina._\n\n${lista.slice(0, 50).map(([k, ate]) => `• ${mk(c.jid, k)} — até ${brData(ate)}`).join("\n")}`, lista.slice(0, 50).map(([k]) => jidDe(c.jid, k)));
});

export function tickVip() {
  const agora = Date.now();
  const lista = lembretesDe();
  for (const l of [...lista]) {
    if (l.quando > agora) continue;
    lista.splice(lista.indexOf(l), 1); gSujo = true;
    avisosVip.push({ jid: l.jid, texto: `⏰ *LEMBRETE* ${l.privado ? "" : mk(l.jid, l.k)}\n_"${l.texto}"_`, mencoes: l.privado ? [] : [jidDe(l.jid, l.k)] });
  }
  const g = contasGlobais();
  for (const [k, m] of Object.entries(g.membros)) {
    if (!m?.vip?.ate) continue;
    if (m.vip.ate <= agora) {
      const origem = m.vip.origem; delete m.vip; gSujo = true;
      const alvoJid = g.jid[k] || `${k}@s.whatsapp.net`;
      avisosVip.push({ jid: alvoJid, texto: `💎 Seu *VIP acabou*. Obrigado por apoiar a Hina!${origem === "dono" ? "" : `\nRenove quando quiser com *!vip*.`}`, mencoes: [] });
    } else if (m.vip.ate - agora <= DIA_MS && m.vip.aviso !== "1d") {
      m.vip.aviso = "1d"; gSujo = true;
      const alvoJid = g.jid[k] || `${k}@s.whatsapp.net`;
      avisosVip.push({ jid: alvoJid, texto: `💎 Seu *VIP vence em menos de 24 h* (${brDataHora(m.vip.ate)}).\nPara continuar com as vantagens, renove com *!vip*.`, mencoes: [] });
    }
  }
}
export async function enviarAvisosVip(sock = null) {
  if (!avisosVip.length) return;
  sock ||= (await import("./conexao.js").catch(() => null))?.sockAtual?.();
  if (!sock) return;
  while (avisosVip.length) {
    const a = avisosVip.shift();
    await sock.sendMessage(a.jid, { text: a.texto, mentions: a.mencoes }).catch(() => {});
  }
}
setInterval(() => { try { tickVip(); } catch {} enviarAvisosVip().catch(() => {}); }, 30_000).unref?.();

const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const premiumAtivas = () => Object.entries(ITENS).filter(([, it]) => it.premium && !it.off);
def(["premium", "propriedadespremium", "lojapremium"], {}, async (c) => {
  const p = c.prefixo;
  const sub = String(c.args[0] || "").toLowerCase(), id = String(c.args[1] || "").toLowerCase();
  const m = conta(c.jid, c.autorJid);
  if (!CFG_JOGO().premium && !c.ehDono) return c.responder("⭐ As propriedades premium estão fechadas no momento.");
  if (sub === "comprar") {
    const it = ITENS[id];
    if (!it?.premium || it.off) return c.responder(`Não achei essa premium. Veja a lista: *${p}premium*`);
    const tem = m.itens?.[id] || 0;
    if (tem >= maxDe(id)) return c.responder(`⭐ Você já tem ${maxDe(id) > 1 ? `${tem}/${maxDe(id)} ` : ""}${it.emoji} *${it.nome}*.`);
    const K = await import("./caixa.js");
    lembrarNomeDoGrupo(c.jid, c.meta?.subject);
    return K.cobrar(c, { tipo: "premium", valor: it.reais, chave: `premium:${id}`, descricao: `${it.nome} (propriedade premium)`, dados: { id, jid: c.jid, autor: c.autorJid } });
  }
  const linhas = premiumAtivas().map(([k, it]) => `${it.emoji} *${it.nome}* (${k})\n   💳 ${reais(it.reais)} · rende ${moedas(it.renda)}/h fixo${m.itens?.[k] ? ` · ✅ ${maxDe(k) > 1 ? `${m.itens[k]}/${maxDe(k)}` : "sua"}` : ""}`);
  return c.responder(`⭐ *PROPRIEDADES PREMIUM*\n_Compra única no Pix · renda fixa todo dia · crise não derruba · bônus da coleta nunca é negativo · é sua para sempre._\n\n${linhas.join("\n") || "_Nenhuma à venda agora._"}\n\n• *${p}premium comprar quiosque*\n• A renda cai junto no *${p}coletar*`);
});
import("./caixa.js").then((K) => K.registrarProduto("premium", {
  aplicar: async (pg) => {
    const d = pg.dados || {};
    if (d.entregue) return;
    const it = ITENS[d.id];
    const m = conta(d.jid, d.autor);
    m.itens ||= {};
    const { valor } = rendaPendente(m);
    m.carteira += valor; m.ultimaColeta = Date.now();
    m.itens[d.id] = Math.min(maxDe(d.id), (m.itens[d.id] || 0) + 1);
    d.entregue = true; marcar(d.jid);
    await K.falar(d.jid, `✅ *PAGAMENTO CONFIRMADO!*\n\n${marca(d.autor)} agora tem ${it?.emoji || "⭐"} *${it?.nome || d.id}*!\n💰 Rende *${moedas(it?.renda || 0)}/h* fixo, todo dia. Colete com *${CONFIG.prefixo}coletar*. 🎉`, { mentions: [d.autor] }).catch(() => {});
  }
})).catch(() => {});

const DJ = { dono: true };
const num = (t) => { const v = lerValor(String(t || ""), Infinity); return Number.isFinite(v) ? v : NaN; };
const nomeIt = (k) => `${ITENS[k]?.emoji || "•"} *${ITENS[k]?.nome || k}* (${k})`;
function logDJ(c, acao, alvo = null, valor = null, extra = null) { try { if (c.isGroup) logAdmin(c, acao, alvo, valor, extra); } catch {} }

def(["menudonojogos", "donojogos", "menujogosdono"], DJ, async (c) => {
  const p = c.prefixo, cfg = CFG_JOGO();
  return c.responder(`🎮 *MENU DONO — JOGOS* 👑
_Controle total do RPG em todos os grupos._

🏘️ *PROPRIEDADES (todas, inclusive premium)*
┃ ${p}djloja — lista tudo com preço, renda e limite
┃ ${p}djpreco item valor — preço em moedas (premium: em R$)
┃ ${p}djrenda item valor — renda por hora
┃ ${p}djmax item n — quantas cada pessoa pode ter
┃ ${p}djdesligar item · ${p}djligar item — tira/volta da loja
┃ ${p}djresetitem item|tudo — volta ao original
┃ ${p}djdar @ item [qtd] — dá propriedade de graça
┃ ${p}djtirar @ item [qtd|tudo] — tira propriedade
┃ ${p}djver @ — propriedades e renda da pessoa

⭐ *PREMIUM (Pix, renda fixa)*
┃ ${p}premium — loja premium (o que os membros veem)
┃ ${p}djcriarpremium id reais renda emoji nome
┃   _ex.: ${p}djcriarpremium iate 150 350000 🛥️ Iate de Luxo_
┃ ${p}djapagarpremium id
┃ ${p}djconfig premium 1/0 — abre/fecha as vendas

📊 *MERCADO DO DIA*
┃ ${p}djmercado — ver o mercado de hoje
┃ ${p}djmercado evento boom_agro|crise_agro|boom_comercio|crise_comercio|boom_industria|crise_industria|normal
┃ ${p}djmercado fator item 1.5 — renda de hoje (0 a 3×)
┃ ${p}djmercado sortear — sorteia de novo

🤝 *EMPRÉSTIMOS*
┃ ${p}djdividas — todas as dívidas abertas
┃ ${p}djperdoar @ — apaga a dívida da pessoa
┃ ${p}djvencer @ — vence a dívida agora (vira calote)

⚙️ *REGRAS DO JOGO* (${p}djconfig chave valor)
┃ roubo ${cfg.rouboMin} — minutos entre roubos
┃ tetodivida ${cfg.tetoDivida} — dívida cresce até N× o valor
┃ juroshoras ${cfg.juroHoras} — a cada quantas horas cresce
┃ jurosmax ${cfg.jurosMax} — juros máximo do empréstimo (%)
┃ venda ${cfg.vendaPct} — % devolvido ao vender propriedade
┃ acumula ${cfg.acumulaHoras} — horas que a renda acumula
┃ maxcomum ${cfg.maxComum} — quantas de cada propriedade comum
┃ bonus ${cfg.bonusMin}-${cfg.bonusMax} — bônus da coleta (%)
┃ cotacao ${fmt(cfg.cotacao)} — moedas por R$ 1
┃ ${p}djconfig reset — volta tudo ao padrão

🪙 *MOEDAS E CONTAS*
┃ ${p}addmoeda @ valor [banco] · ${p}rmvmoeda @ valor|tudo
┃ ${p}setmoeda @ valor · ${p}vercarteira @ · ${p}zerarcarteira @
┃ ${p}congelar @ · ${p}descongelar @ · ${p}estornarnivel @
┃ ${p}logeco — log das ações do dono · ${p}ecogrupo
┃ ${p}limiteganho — quanto cada jogo paga
┃ ${p}moedanivel — prêmio por nível · ${p}saldohina

💎 *VIP E VENDAS*
┃ ${p}addvip @ dias · ${p}rmvip @ · ${p}listavip
┃ ${p}lojahina moedas preco|limite — preço das moedas no Pix

📢 *EVENTOS*
┃ ${p}enquete pergunta, op1 ou op2 prêmio

_Tudo vale para todos os grupos e fica salvo._`);
});

def(["djloja", "djitens"], DJ, async (c) => {
  const merc = atualizarMercado();
  const lin = Object.entries(ITENS).map(([k, it]) => `${it.off ? "🚫 " : ""}${it.emoji} *${k}* — ${it.premium ? `💳 ${reais(it.reais)}` : moedas(it.preco)} · ${moedas(it.renda)}/h${it.fixo ? " fixo" : ` (hoje ×${(merc.fatores?.[k] ?? 1).toFixed(2)})`} · máx ${maxDe(k)}${AJ.itens[k] ? " ✏️" : ""}`);
  return c.responder(`🏘️ *TODAS AS PROPRIEDADES*\n_✏️ = mudada por você · 🚫 = fora da loja_\n\n${lin.join("\n")}`);
});

function mudarItem(c, campo, rotulo) {
  const k = String(c.args[0] || "").toLowerCase(), it = ITENS[k];
  if (!it) return c.responder(`Item não encontrado. Veja *${c.prefixo}djloja*.`);
  const v = num(c.args[1]);
  if (!(v >= 0)) return c.responder(`Use: *${c.prefixo}dj${campo === "reais" ? "preco" : campo} ${k} valor*`);
  if (it.premium && campo === "preco") campo = "reais";
  const base = it.premium && !PREMIUM_PADRAO[k] && AJ.premium[k] ? AJ.premium[k] : (AJ.itens[k] ||= {});
  base[campo] = campo === "max" ? Math.max(1, Math.floor(v)) : v;
  salvarAjustes(); aplicarAjustes(); logDJ(c, `dj ${campo} ${k}`, null, v);
  const it2 = ITENS[k];
  return c.responder(`✅ ${nomeIt(k)}\n${rotulo}: *${campo === "reais" ? reais(v) : campo === "max" ? it2.max : moedas(v)}*${campo === "renda" ? "/h" : ""}`);
}
def(["djpreco"], DJ, (c) => mudarItem(c, "preco", "Preço"));
def(["djrenda"], DJ, (c) => mudarItem(c, "renda", "Renda"));
def(["djmax"], DJ, (c) => mudarItem(c, "max", "Máximo por pessoa"));
for (const [nome, off] of [["djdesligar", true], ["djligar", false]]) def([nome], DJ, async (c) => {
  const k = String(c.args[0] || "").toLowerCase();
  if (!ITENS[k]) return c.responder(`Item não encontrado. Veja *${c.prefixo}djloja*.`);
  (AJ.itens[k] ||= {}).off = off; salvarAjustes(); aplicarAjustes(); logDJ(c, `${nome} ${k}`);
  return c.responder(`${off ? "🚫" : "✅"} ${nomeIt(k)} ${off ? "saiu da loja (quem já tem continua recebendo a renda)" : "voltou para a loja"}.`);
});
def(["djresetitem"], DJ, async (c) => {
  const k = String(c.args[0] || "").toLowerCase();
  if (k === "tudo") { AJ.itens = {}; salvarAjustes(); aplicarAjustes(); return c.responder("♻️ Todas as propriedades voltaram ao preço, renda e limite originais."); }
  if (!ITENS[k]) return c.responder(`Item não encontrado. Veja *${c.prefixo}djloja*.`);
  delete AJ.itens[k]; salvarAjustes(); aplicarAjustes();
  return c.responder(`♻️ ${nomeIt(k)} voltou ao original.`);
});
def(["djdar", "djtirar"], { ...DJ, grupo: true }, async (c) => {
  const dar = c.cmd !== "djtirar";
  const alvo = alvoMarcado(c);
  const resto = c.args.filter((a) => !/^@/.test(a) && !/^\d{10,}$/.test(a));
  const k = String(resto[0] || "").toLowerCase();
  if (!alvo || !ITENS[k]) return c.responder(`Use: *${c.prefixo}${dar ? "djdar" : "djtirar"} @pessoa item ${dar ? "[qtd]" : "[qtd|tudo]"}*`);
  const m = conta(c.jid, alvo); m.itens ||= {};
  const { valor } = rendaPendente(m); m.carteira += valor; m.ultimaColeta = Date.now();
  const tem = m.itens[k] || 0;
  const q = String(resto[1] || "").toLowerCase() === "tudo" ? tem : Math.max(1, Math.floor(Number(resto[1]) || 1));
  m.itens[k] = dar ? tem + q : Math.max(0, tem - q);
  if (!m.itens[k]) delete m.itens[k];
  marcar(c.jid); logDJ(c, dar ? `djdar ${k}` : `djtirar ${k}`, alvo, q);
  return c.responder(`${dar ? "🎁" : "➖"} ${marca(alvo)} ${dar ? "ganhou" : "perdeu"} ${q}× ${nomeIt(k)}. Agora tem *${m.itens[k] || 0}*.${dar && m.itens[k] > maxDe(k) ? "\n_(Passou do limite normal: dado pelo dono.)_" : ""}`, [alvo]);
});
def(["djver"], { ...DJ, grupo: true }, async (c) => {
  const alvo = alvoMarcado(c) || c.autorJid;
  const m = conta(c.jid, alvo);
  const { valor, porHora } = rendaPendente(m);
  const lin = Object.entries(m.itens || {}).filter(([, q]) => q > 0).map(([k, q]) => `• ${q}× ${nomeIt(k)} — ${moedas(rendaComFator(k) * q)}/h`);
  return c.responder(`🏘️ *PROPRIEDADES* — ${marca(alvo)}\n\n${lin.join("\n") || "• nenhuma"}\n\n💰 ${moedas(porHora)}/h · para coletar: ${moedas(valor)}`, [alvo]);
});
def(["djcriarpremium"], DJ, async (c) => {
  const [id0, rs, rd, emoji, ...nome] = c.args;
  const id = String(id0 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const v = Number(String(rs || "").replace(",", ".")), renda = num(rd);
  if (!id || !(v >= 1) || !(renda > 0) || !nome.length) return c.responder(`Use: *${c.prefixo}djcriarpremium id reais renda emoji nome*\nEx.: *${c.prefixo}djcriarpremium iate 150 350000 🛥️ Iate de Luxo*`);
  if (ORIGINAIS[id]) return c.responder("Esse id já é de uma propriedade comum. Escolha outro.");
  AJ.premium[id] = { nome: nome.join(" ").slice(0, 40), emoji, reais: v, renda };
  AJ.premiumApagadas = AJ.premiumApagadas.filter((x) => x !== id);
  salvarAjustes(); aplicarAjustes(); logDJ(c, `djcriarpremium ${id}`, null, v);
  return c.responder(`⭐ Premium criada: ${nomeIt(id)}\n💳 ${reais(v)} · ${moedas(renda)}/h fixo\nJá aparece no *${c.prefixo}premium*.`);
});
def(["djapagarpremium"], DJ, async (c) => {
  const id = String(c.args[0] || "").toLowerCase();
  if (!ITENS[id]?.premium) return c.responder(`Premium não encontrada. Veja *${c.prefixo}djloja*.`);
  delete AJ.premium[id]; if (!AJ.premiumApagadas.includes(id)) AJ.premiumApagadas.push(id);
  salvarAjustes(); aplicarAjustes();
  return c.responder(`🗑️ Premium *${id}* apagada da loja. _Quem já tinha fica com o item no inventário, mas ele para de render. Para manter a renda, use ${c.prefixo}djdesligar ${id} no lugar._`);
});
def(["djmercado"], DJ, async (c) => {
  const sub = String(c.args[0] || "").toLowerCase();
  const m = atualizarMercado();
  if (sub === "evento") {
    const ev = EVENTOS_POSSIVEIS.find((e) => e.id === String(c.args[1] || "").toLowerCase());
    if (!ev) return c.responder(`Eventos: ${EVENTOS_POSSIVEIS.map((e) => `*${e.id}*`).join(", ")}`);
    for (const [k, it] of Object.entries(ITENS)) if (!it.fixo) m.fatores[k] = ev.cat && it.cat === ev.cat ? Math.min(3, ev.fator) : (m.fatores[k] ?? 1);
    m.evento = { id: ev.id, cat: ev.cat, fator: ev.fator, emoji: ev.emoji, nome: ev.nome };
    salvarMercado(); logDJ(c, `djmercado evento ${ev.id}`);
    return c.responder(`${ev.emoji} Evento de hoje: *${ev.nome}* (vale até meia-noite).`);
  }
  if (sub === "fator") {
    const k = String(c.args[1] || "").toLowerCase(), f = Number(String(c.args[2] || "").replace(",", "."));
    if (!ITENS[k] || !(f >= 0 && f <= 3)) return c.responder(`Use: *${c.prefixo}djmercado fator item 1.5* (de 0 a 3)`);
    m.fatores[k] = f; salvarMercado();
    return c.responder(`📊 ${nomeIt(k)} hoje rende ×${f} = *${moedas(ITENS[k].renda * f)}/h* (até meia-noite).`);
  }
  if (sub === "sortear") { _mercado.dia = null; const n = atualizarMercado(); return c.responder(`🎲 Mercado sorteado de novo: ${n.evento.emoji} *${n.evento.nome}*.`); }
  const top = Object.entries(m.fatores || {}).filter(([k]) => ITENS[k] && !ITENS[k].fixo).sort((a, b) => b[1] - a[1]);
  const f = ([k, v]) => `${ITENS[k].emoji} ${k} ×${v.toFixed(2)}`;
  return c.responder(`📊 *MERCADO DE HOJE*\n${m.evento?.emoji || "📊"} ${m.evento?.nome || "Mercado estável"}\n\n🟢 Melhores: ${top.slice(0, 4).map(f).join(" · ")}\n🔴 Piores: ${top.slice(-4).map(f).join(" · ")}`);
});
def(["djdividas"], DJ, async (c) => {
  const l = emprestimosDe().map((e) => { crescerDivida(e); return e; });
  if (!l.length) return c.responder("🤝 Nenhuma dívida aberta.");
  return c.responder(`🤝 *DÍVIDAS ABERTAS* (${l.length})\n\n${l.slice(0, 40).map((e) => `• ${mk(e.jid, e.devedor)} deve *${moedas(restante(e))}* a ${mk(e.jid, e.credor)}${e.atrasado ? " 📛" : ""} (pegou ${moedas(e.valor)} a ${e.juros}%)`).join("\n")}`, l.slice(0, 40).flatMap((e) => [jidDe(e.jid, e.devedor), jidDe(e.jid, e.credor)]));
});
def(["djperdoar", "djvencer"], { ...DJ, grupo: true }, async (c) => {
  const vencer = c.cmd === "djvencer";
  const alvo = alvoMarcado(c);
  const e = alvo ? dividaDe(c.jid, alvo) : null;
  if (!e) return c.responder("Essa pessoa não tem dívida aberta.");
  if (vencer) { e.venceEm = Date.now() - 1; verificarEmprestimos(); logDJ(c, "djvencer", alvo); return c.responder(`📛 Dívida de ${marca(alvo)} vencida agora.`, [alvo]); }
  const l = emprestimosDe(); l.splice(l.indexOf(e), 1); salvarIndiceEmp(); marcar(c.jid); logDJ(c, "djperdoar", alvo, restante(e));
  return c.responder(`🕊️ Dívida de ${marca(alvo)} (${moedas(restante(e))}) apagada pelo dono.`, [alvo]);
});
const CHAVES_CFG = { roubo: "rouboMin", tetodivida: "tetoDivida", juroshoras: "juroHoras", jurosmax: "jurosMax", venda: "vendaPct", acumula: "acumulaHoras", maxcomum: "maxComum", cotacao: "cotacao", premium: "premium" };
def(["djconfig"], DJ, async (c) => {
  const k = String(c.args[0] || "").toLowerCase(), bruto = String(c.args[1] || "");
  if (k === "reset") { AJ.cfg = {}; salvarAjustes(); aplicarAjustes(); return c.responder("♻️ Regras do jogo voltaram ao padrão."); }
  if (k === "bonus") {
    const [a, b] = bruto.split("-").map(Number);
    if (!(a >= 0 && b >= a && b <= 500)) return c.responder(`Use: *${c.prefixo}djconfig bonus 80-120*`);
    AJ.cfg.bonusMin = a; AJ.cfg.bonusMax = b; salvarAjustes(); return c.responder(`✅ Bônus da coleta: *${a}% a ${b}%*.`);
  }
  const campo = CHAVES_CFG[k];
  if (!campo) return c.responder(`Chaves: ${Object.keys(CHAVES_CFG).map((x) => `*${x}*`).join(", ")}, *bonus*, *reset*. Veja *${c.prefixo}menudonojogos*.`);
  const v = campo === "premium" ? /^(1|on|sim|ligar)$/i.test(bruto) : num(bruto);
  if (campo !== "premium" && !(v >= 0)) return c.responder(`Use: *${c.prefixo}djconfig ${k} valor*`);
  if (["juroHoras", "maxComum", "tetoDivida", "acumulaHoras", "cotacao"].includes(campo) && !(v > 0)) return c.responder("O valor precisa ser maior que 0.");
  AJ.cfg[campo] = v; salvarAjustes(); aplicarAjustes(); logDJ(c, `djconfig ${k}`, null, typeof v === "number" ? v : null, String(v));
  return c.responder(`✅ *${k}* = *${campo === "premium" ? (v ? "ligado" : "desligado") : fmt(v)}*.`);
});

export const COMANDOS_ECONOMIA = C;
export const ITENS_RPG = ITENS;
export const ATIVOS_RPG = ATIVOS;

const ARQ_MOEDA_NIVEL = path.join(CONFIG.pastas.storage, "moeda-nivel.json");
export function cfgMoedaNivel() {
  const d = lerJson(ARQ_MOEDA_NIVEL, null) || {};
  return { ativo: d.ativo === true, porNivel: Math.max(0, Math.floor(Number(d.porNivel) || 1000)) };
}
export function pagarNivel(jid, id, nivel) {
  const cfg = cfgMoedaNivel();
  if (!cfg.ativo || !cfg.porNivel || !cfgRpg(jid).economia) return 0;
  const m = conta(jid, id);
  if ((m.nivelPago || 0) >= nivel) return 0;
  m.nivelPago = nivel;
  creditar(jid, id, cfg.porNivel, { tipo: "subiu de nível" });
  return cfg.porNivel;
}
C.push({ nomes: ["moedanivel", "moedasnivel", "nivelmoeda"], dono: true, rpg: true, run: async (c) => {
  const p = c.prefixo;
  const cfg = cfgMoedaNivel();
  const a = String(c.args[0] || "").toLowerCase().replace(/\./g, "");
  if (["on", "1", "ligar"].includes(a)) { if (cfg.ativo) return c.responder("⭐ As moedas por nível *já estão ligadas*."); cfg.ativo = true; }
  else if (["off", "0", "desligar"].includes(a)) { if (!cfg.ativo) return c.responder("⭐ As moedas por nível *já estão desligadas*."); cfg.ativo = false; }
  else if (/^\d+$/.test(a)) { if (Number(a) > 10_000_000) return c.responder("Máximo: 10.000.000 por nível."); cfg.porNivel = Number(a); }
  else return c.responder(`⭐ *MOEDAS POR NÍVEL* (todos os grupos)\n\nSituação: ${cfg.ativo ? "🟢 ligado" : "🔴 desligado"}\nPrêmio: *${moedas(cfg.porNivel)}* por nível subido\n\n*${p}moedanivel on* / *off*\n*${p}moedanivel 5000* — muda o prêmio`);
  salvarJson(ARQ_MOEDA_NIVEL, cfg);
  return c.responder(`⭐ Moedas por nível: ${cfg.ativo ? "🟢 ligado" : "🔴 desligado"} · *${moedas(cfg.porNivel)}* por nível.`);
} });

const ARQ_CAIXA = path.join(CONFIG.pastas.storage, "caixa-hina.json");
let CX = null, cxSujo = false;
const NOME_JOGO = { cc: "moeda", caraoucoroa: "moeda", slots: "slot", cacaniquel: "slot", cavalo: "corrida", cavalos: "corrida", crash: "foguete", raspa: "raspadinha", maiormenor: "dados", "pênalti": "penalti", copo: "copos", mines: "minas", campominado: "minas", ppt: "jokenpo", cartas: "carta", basquete: "arremesso", cesta: "arremesso" };
const ORIGENS = { apostas: "🎰 Apostas", crime: "🚨 Multas do crime", assassino: "🔪 Assassino de aluguel", cdb: "🏦 Multa do CDB" };
function caixa() {
  if (CX) return CX;
  const d = lerJson(ARQ_CAIXA, null);
  CX = d && typeof d === "object" ? d : {};
  CX.desde ||= Date.now(); CX.saldo ||= 0; CX.origens ||= {}; CX.jogos ||= {}; CX.grupos ||= {}; CX.dias ||= {};
  return CX;
}
function gravarCaixa() { if (cxSujo && CX) { try { salvarJson(ARQ_CAIXA, CX); cxSujo = false; } catch {} } }
setInterval(gravarCaixa, 20_000).unref?.();
process.on("exit", gravarCaixa);
export function paraCaixa(jid, valor, origem, jogo = null, apostado = 0) {
  valor = Math.trunc(Number(valor) || 0);
  if (!valor && !apostado) return;
  const x = caixa();
  x.saldo += valor;
  x.origens[origem] = (x.origens[origem] || 0) + valor;
  const g = (x.grupos[jid] ||= { saldo: 0 }); g.saldo += valor;
  const dia = hojeBr(); x.dias[dia] = (x.dias[dia] || 0) + valor;
  const dias = Object.keys(x.dias).sort(); if (dias.length > 60) for (const d of dias.slice(0, dias.length - 60)) delete x.dias[d];
  if (jogo) { const n = NOME_JOGO[jogo] || jogo; const j = (x.jogos[n] ||= { vezes: 0, apostado: 0, lucro: 0 }); j.vezes++; j.apostado += apostado; j.lucro += valor; }
  cxSujo = true;
}
C.push({ nomes: ["saldohina", "caixahina", "cofrehina", "lucrohina", "saldodahina"], dono: true, rpg: true, run: async (c) => {
  const x = caixa();
  const p = c.prefixo;
  if (String(c.args[0] || "").toLowerCase() === "zerar") {
    if (String(c.args[1] || "").toLowerCase() !== "confirmar") return c.responder(`⚠️ Isso apaga todo o histórico do caixa da Hina.\nPara confirmar: *${p}saldohina zerar confirmar*`);
    CX = { desde: Date.now(), saldo: 0, origens: {}, jogos: {}, grupos: {}, dias: {} }; cxSujo = true; gravarCaixa();
    return c.responder("🧹 Caixa da Hina zerado. A contagem recomeça agora.");
  }
  const sinal = (v) => `${v < 0 ? "−" : "+"}${moedas(Math.abs(v))}`;
  const ultimos = (n) => { let t = 0; for (let i = 0; i < n; i++) t += x.dias[new Date(Date.now() - 3 * 3600_000 - i * 86_400_000).toISOString().slice(0, 10)] || 0; return t; };
  const origens = Object.entries(ORIGENS).filter(([k]) => x.origens[k]).map(([k, nome]) => `${nome}: *${sinal(x.origens[k])}*`);
  const jogos = Object.entries(x.jogos).sort((a, b) => b[1].lucro - a[1].lucro).slice(0, 8)
    .map(([n, j], i) => `${i + 1}. ${n} — *${sinal(j.lucro)}* (${j.vezes} aposta${j.vezes === 1 ? "" : "s"}, ficou com ${j.apostado ? Math.round(j.lucro / j.apostado * 100) : 0}% do apostado)`);
  const grupos = Object.entries(x.grupos).sort((a, b) => b[1].saldo - a[1].saldo).slice(0, 5)
    .map(([jid, g], i) => `${i + 1}. ${(dados(jid).nome || jid.split("@")[0]).slice(0, 30)} — *${sinal(g.saldo)}*`);
  const texto = `🌸💰 *CAIXA DA SORASAKI*\n_Tudo que o pessoal perde no RPG vem para cá. Só o dono vê._\n\n` +
    `💰 Saldo: *${moedas(x.saldo)}*\n📅 Hoje: *${sinal(ultimos(1))}* · 7 dias: *${sinal(ultimos(7))}* · 30 dias: *${sinal(ultimos(30))}*\n` +
    `🗓️ Contando desde ${new Date(x.desde).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\n` +
    `*De onde veio*\n${origens.join("\n") || "_Nada ainda._"}\n\n` +
    `*Jogos que mais renderam*\n${jogos.join("\n") || "_Ninguém apostou ainda._"}\n\n` +
    `*Grupos que mais renderam*\n${grupos.join("\n") || "_Nenhum ainda._"}` +
    (c.isGroup ? `\n\nNeste grupo: *${sinal(x.grupos[c.jid]?.saldo || 0)}*` : "") +
    `\n\n_Apostas: entra o que foi apostado e sai o prêmio pago, então um dia de sorte do pessoal pode deixar o dia negativo._\n_Zerar: ${p}saldohina zerar_`;
  if (!c.isGroup) return c.responder(texto);
  try { await c.sock.sendMessage(c.autorJid, { text: texto }); return c.responder("📩 Te mandei o caixa no privado."); }
  catch { return c.responder(texto); }
} });

const ASSALTO_ESPERA = DIA;
const ASSALTO_PROTECAO = 2 * DIA;
const hashSenha = (k, senha) => crypto.createHash("sha256").update(`hina-banco|${k}|${senha}`).digest("hex");
const def2 = (nomes, opc, run) => C.push({ nomes, ...opc, rpg: true, run: (c) => emTransacao(c.jid, nomes[0], chave(c.jid, c.autorJid), () => run(c)) });

async function definirSenha(c, modo) {
  const p = c.prefixo;
  const cmd = modo === "criar" ? "senhacriar" : "senhatrocar";
  if (c.isGroup) {
    try { await c.sock.sendMessage(c.jid, { delete: c.msg.key }); } catch {}
    return c.responder(`🙈 Não mande a senha no grupo! Apaguei (se eu for admin). Use no meu *privado*: *${p}${cmd} 4821*`);
  }
  const senha = String(c.args[0] || "").trim();
  const m = conta(c.jid, c.autorJid);
  if (modo === "criar" && m.senhaBanco) return c.responder(`🔐 Você já tem senha no banco. Para mudar, use *${p}senhatrocar NOVA*.`);
  if (modo === "trocar" && !m.senhaBanco) return c.responder(`🔐 Você ainda não tem senha no banco. Crie com *${p}senhacriar 4821*.`);
  if (!/^\d{4,6}$/.test(senha)) return c.responder(`🔐 *${modo === "criar" ? "CRIAR" : "TROCAR"} SENHA DO BANCO*\n\nUse: *${p}${cmd} 4821* (4 a 6 números, aqui no privado)\n\n_Sem senha você não deposita no banco. Quem descobrir a senha pode assaltar de 10% a 40% do seu banco. Não use a mesma senha de nada real._`);
  if (/^(\d)\1+$/.test(senha) || "0123456789".includes(senha) || "9876543210".includes(senha)) return c.responder("🙅 Senha fácil demais (sequência ou números repetidos). Escolha outra.");
  const k = chave(c.jid, c.autorJid);
  if (modo === "trocar" && hashSenha(k, senha) === m.senhaBanco) return c.responder("🔁 Essa já é a sua senha atual. Escolha uma diferente.");
  m.senhaBanco = hashSenha(k, senha);
  m.senhaTrocadaEm = Date.now();
  marcar(c.jid);
  gravarEconomia();
  return c.responder(`✅ Senha do banco ${modo === "criar" ? "criada" : "trocada"}! (${senha.length} dígitos)\n${modo === "criar" ? `Já pode depositar com *${p}banco depositar 500*.\n` : ""}_Guarde só pra você. Trocar depois: ${p}senhatrocar NOVA_`);
}
def2(["senhacriar", "criarsenha"], {}, (c) => definirSenha(c, "criar"));
def2(["senhatrocar", "trocarsenha"], {}, (c) => definirSenha(c, "trocar"));

def2(["assaltarbanco", "roubarbanco", "assaltobanco"], G, async (c) => {
  const p = c.prefixo;
  if (!exigir(c, "roubo")) return;
  const alvo = alvoMarcado(c);
  const palpite = valoresDe(c).find((a) => /^\d+$/.test(a)) || "";
  if (!alvo || !palpite) return c.responder(`🏦🔓 *ASSALTO AO BANCO*\n\nUse: *${p}assaltarbanco @fulano SENHA*\n\n• Acertou a senha: leva de *10% a 40%* do banco da pessoa.\n• Errou: a pessoa é avisada no grupo.\n• Você só pode tentar *1 vez por dia*.\n• Quem foi assaltado fica *2 dias* protegido.`);
  if (mesmaPessoa(c, alvo, c.autorJid)) return c.responder("Assaltar o próprio banco? Use o *" + p + "sacar*. 😅");
  if (ehOBot(c, alvo)) return c.responder("O cofre da Hina é à prova de balas. 🌸🔒");
  if (!noGrupo(c, alvo)) return c.responder("Essa pessoa não está no grupo.");
  if (protegidoVip(c, alvo)) return;
  const eu = conta(c.jid, c.autorJid);
  const vit = conta(c.jid, alvo);
  if (vit.congelado) return c.responder(`🧊 A conta de ${marca(alvo)} está congelada.`, [alvo]);
  const falta = ASSALTO_ESPERA - (Date.now() - (eu.ultimoAssalto || 0));
  if (falta > 0) return c.responder(`🚨 A polícia ainda está de olho em você. Próxima tentativa em *${espera(falta)}*.`);
  const prot = ASSALTO_PROTECAO - (Date.now() - (vit.assaltadoEm || 0));
  if (prot > 0) return c.responder(`🛡️ O banco de ${marca(alvo)} foi assaltado há pouco e está com segurança reforçada por mais *${espera(prot)}*.`, [alvo]);
  if (!vit.senhaBanco) return c.responder(`${marca(alvo)} ainda não tem senha no banco (e por isso não consegue depositar). Nada pra assaltar. 🫥`, [alvo]);
  if ((vit.banco || 0) < 1000) return c.responder(`O banco de ${marca(alvo)} está quase vazio. Nem vale o risco. 🫥`, [alvo]);
  eu.ultimoAssalto = Date.now();
  if (hashSenha(chave(c.jid, alvo), palpite) === vit.senhaBanco) {
    const pct = sorteio(10, 40);
    const valor = Math.floor(vit.banco * pct / 100);
    vit.banco -= valor; eu.carteira = Math.min(LIMITE, eu.carteira + valor);
    vit.assaltadoEm = Date.now();
    delete vit.senhaBanco;
    anotar(eu, "assalto ao banco", valor, usuario(alvo)); anotar(vit, "banco assaltado", -valor, usuario(c.autorJid));
    marcar(c.jid);
    return c.responder(`💥🏦 *ASSALTO CONCLUÍDO!*\n\n🥷 ${marca(c.autorJid)} descobriu a senha do banco de ${marca(alvo)} e levou *${moedas(valor)}* (${pct}%)!\n\n${marca(alvo)}, sua senha vazou e foi apagada: crie outra no meu privado com *${p}senhacriar*. Seu banco fica protegido por 2 dias.`, [c.autorJid, alvo]);
  }
  marcar(c.jid);
  return c.responder(`🚨 ${marca(c.autorJid)} tentou abrir o banco de ${marca(alvo)} e *errou a senha*!\n${marca(alvo)}, fique esperto(a) — troque a senha no meu privado com *${p}senhatrocar* se achar que estão perto.\n\n_${marca(c.autorJid)}, nova tentativa só daqui a 1 dia._`, [c.autorJid, alvo]);
});

const ASSASSINO_PRECO = 1_500;
const ASSASSINO_ESPERA = 6 * HORA;
const ASSASSINO_PROTECAO = 12 * HORA;
def2(["assassino", "assassinodealuguel", "matador", "contratar"], G, async (c) => {
  const p = c.prefixo;
  if (!exigir(c, "roubo")) return;
  const alvo = alvoMarcado(c);
  if (!alvo) return c.responder(`🔪 *ASSASSINO DE ALUGUEL*\n\nUse: *${p}assassino @fulano*\n\n💰 Contrato: ${moedas(ASSASSINO_PRECO)} (pago na hora)\n🎯 35% — acerta: o alvo perde 10% a 20% da carteira e você fica com metade\n🚓 35% — é pego e te entrega: você paga *${moedas(1000)} a ${moedas(5000)}* de multa ao alvo\n💨 30% — erra o alvo e foge com o seu dinheiro\n\n_O banco não é atingido. Um contrato a cada 6 h; o alvo fica 12 h protegido._`);
  if (mesmaPessoa(c, alvo, c.autorJid)) return c.responder("Contratar alguém contra você mesmo? Vá descansar. 😅");
  if (ehOBot(c, alvo)) return c.responder("Ninguém aceita esse contrato. A Hina é intocável. 🌸🗡️");
  if (!noGrupo(c, alvo)) return c.responder("Essa pessoa não está no grupo.");
  if (protegidoVip(c, alvo)) return;
  const eu = conta(c.jid, c.autorJid);
  const vit = conta(c.jid, alvo);
  if (vit.congelado) return c.responder(`🧊 A conta de ${marca(alvo)} está congelada.`, [alvo]);
  const falta = ASSASSINO_ESPERA - (Date.now() - (eu.ultimoAssassino || 0));
  if (falta > 0) return c.responder(`🕶️ Os assassinos não querem trabalhar com você agora. Tente em *${espera(falta)}*.`);
  const prot = ASSASSINO_PROTECAO - (Date.now() - (vit.alvoAssassinoEm || 0));
  if (prot > 0) return c.responder(`🛡️ ${marca(alvo)} sofreu um atentado há pouco e está com seguranças. Tente em *${espera(prot)}*.`, [alvo]);
  if (eu.carteira < ASSASSINO_PRECO) return c.responder(`💸 O contrato custa ${moedas(ASSASSINO_PRECO)} na mão. Você tem ${moedas(eu.carteira)}.`);
  if (vit.carteira < 1_000) return c.responder(`${marca(alvo)} está com a carteira quase vazia. Nenhum assassino aceita esse serviço. 🫥`, [alvo]);
  eu.carteira -= ASSASSINO_PRECO;
  eu.ultimoAssassino = Date.now();
  paraCaixa(c.jid, ASSASSINO_PRECO, "assassino");
  vit.alvoAssassinoEm = Date.now();
  anotar(eu, "contratou assassino", -ASSASSINO_PRECO, usuario(alvo));
  const r = aleatorio();
  if (r < 0.35) {
    const perda = Math.floor(vit.carteira * sorteio(10, 20) / 100);
    const parte = Math.floor(perda / 2);
    vit.carteira -= perda; eu.carteira = Math.min(LIMITE, eu.carteira + parte);
    paraCaixa(c.jid, perda - parte, "assassino");
    anotar(vit, "atacado por assassino", -perda, usuario(c.autorJid)); anotar(eu, "serviço do assassino", parte, usuario(alvo));
    marcar(c.jid);
    return c.responder(`🔪🩸 *SERVIÇO FEITO!*\n\nO assassino contratado por ${marca(c.autorJid)} pegou ${marca(alvo)} desprevenido(a)!\n💸 ${marca(alvo)} perdeu *${moedas(perda)}* da carteira.\n💰 ${marca(c.autorJid)} recebeu *${moedas(parte)}* (a outra metade ficou com o assassino).\n\n_${marca(alvo)} fica 12 h protegido(a). Dica: guarde moedas no ${p}banco._`, [c.autorJid, alvo]);
  }
  if (r < 0.70) {
    const multa = Math.min(sorteio(1_000, 5_000), eu.carteira + (eu.banco || 0));
    const daMao = Math.min(eu.carteira, multa);
    eu.carteira -= daMao; eu.banco = Math.max(0, (eu.banco || 0) - (multa - daMao));
    vit.carteira = Math.min(LIMITE, vit.carteira + multa);
    anotar(eu, "assassino pego (multa)", -multa, usuario(alvo)); anotar(vit, "indenização", multa, usuario(c.autorJid));
    marcar(c.jid);
    return c.responder(`🚓🚨 *O ASSASSINO FOI PEGO!*\n\nA polícia prendeu o assassino antes do ataque, e ele entregou quem contratou: ${marca(c.autorJid)}!\n⚖️ Multa de *${moedas(multa)}*, paga a ${marca(alvo)} como indenização.${multa > daMao ? `\n_(${moedas(multa - daMao)} saiu do banco porque a mão não deu.)_` : ""}`, [c.autorJid, alvo]);
  }
  marcar(c.jid);
  return c.responder(`💨 *O ASSASSINO ERROU!*\n\n${marca(alvo)} escapou por pouco, e o assassino sumiu com os ${moedas(ASSASSINO_PRECO)} de ${marca(c.autorJid)}. 😬`, [c.autorJid, alvo]);
});
