import fs from "fs";
import path from "path";
import { usuario, participante } from "./grupos.js";
import { umDe, inteiro } from "./sorte.js";

export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const aleatorio = (lista) => umDe(lista);

const HINA = ["🌸", "💜", "🤍", "🪽", "🎀", "✨", "💮", "🌷"];
export const hina = () => aleatorio(HINA);
export const coracao = hina;

export function reagir(sock, msg, emoji) {
  return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});
}

export function audio(sock, jid, nome, quoted = null) {
  const arq = path.resolve("database/midia/audios", nome);
  if (!fs.existsSync(arq)) return Promise.resolve();
  return sock.sendMessage(jid, { audio: fs.readFileSync(arq), mimetype: "audio/mp4", ptt: true }, quoted ? { quoted } : {}).catch(() => {});
}

export function mencoesDoTexto(texto, meta = null) {
  const out = [];
  for (const m of String(texto || "").matchAll(/@(\d{5,20})/g)) {
    const n = m[1];
    const p = meta ? participante(meta, [n]) : null;
    const id = p?.id || (n.length > 13 ? `${n}@lid` : `${n}@s.whatsapp.net`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function partesBr(d = new Date()) {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: p.day, mes: p.month, ano: p.year, hora: p.hour, minuto: p.minute, segundo: p.second };
}
export const dataBr = (d = new Date()) => { const p = partesBr(d); return `${p.dia}/${p.mes}/${p.ano}`; };
export const horaBr = (d = new Date()) => { const p = partesBr(d); return `${p.hora}:${p.minuto}:${p.segundo}`; };
export const partesData = partesBr;

export function tempo(d = new Date()) {
  const h = Number(partesBr(d).hora);
  return h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (n) => MESES[Number(n) - 1] || "";

export function horarioParaMs(entrada, agora = Date.now()) {
  const t = String(entrada || "").trim().toLowerCase();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) {
    const p = partesBr(new Date(agora));
    let alvo = Date.UTC(Number(p.ano), Number(p.mes) - 1, Number(p.dia), Number(hm[1]) + 3, Number(hm[2]), 0);
    if (alvo <= agora) alvo += 86_400_000;
    return alvo;
  }
  const rel = /^(\d{1,4})\s*(h|m)$/.exec(t);
  if (rel) return agora + Number(rel[1]) * (rel[2] === "h" ? 3_600_000 : 60_000);
  return null;
}
export function dataHoraParaMs(hora, data) {
  const [hh, mm] = String(hora).split(":").map(Number);
  const [dd, MM, yyyy] = String(data || dataBr()).split("/").map(Number);
  if ([hh, mm, dd, MM, yyyy].some((x) => !Number.isFinite(x))) return null;
  return Date.UTC(yyyy, MM - 1, dd, hh + 3, mm, inteiro(0, 29));
}

export function restante(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { dias: Math.floor(s / 86400), horas: Math.floor(s / 3600) % 24, minutos: Math.floor(s / 60) % 60, segundos: s % 60 };
}

export function estadoDoNumero(id) {
  const n = usuario(id);
  if (!n.startsWith("55")) return "Não é do Brasil";
  const d = Number(n.slice(2, 4));
  const T = [[[11, 19], "São Paulo"], [[21, 22], "Rio de Janeiro"], [[24, 24], "Rio de Janeiro"], [[27, 28], "Espírito Santo"], [[31, 38], "Minas Gerais"], [[41, 46], "Paraná"], [[47, 49], "Santa Catarina"], [[51, 51], "Rio Grande do Sul"], [[53, 55], "Rio Grande do Sul"], [[61, 61], "Distrito Federal"], [[62, 62], "Goiás"], [[64, 64], "Goiás"], [[63, 63], "Tocantins"], [[65, 66], "Mato Grosso"], [[67, 67], "Mato Grosso do Sul"], [[68, 68], "Acre"], [[69, 69], "Rondônia"], [[71, 71], "Bahia"], [[73, 75], "Bahia"], [[77, 77], "Bahia"], [[79, 79], "Sergipe"], [[81, 81], "Pernambuco"], [[87, 87], "Pernambuco"], [[82, 82], "Alagoas"], [[83, 83], "Paraíba"], [[84, 84], "Rio Grande do Norte"], [[85, 85], "Ceará"], [[88, 88], "Ceará"], [[86, 86], "Piauí"], [[89, 89], "Piauí"], [[91, 91], "Pará"], [[93, 94], "Pará"], [[92, 92], "Amazonas"], [[97, 97], "Amazonas"], [[95, 95], "Roraima"], [[96, 96], "Amapá"], [[98, 99], "Maranhão"]];
  const achado = T.find(([[a, b]]) => d >= a && d <= b);
  return achado ? achado[1] : "Não está no banco de dados brasileiro";
}
