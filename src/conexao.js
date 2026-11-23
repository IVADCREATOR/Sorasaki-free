import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import pino from "pino";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState } from "baileys";
import { cfg, soNumero } from "./lib/config.js";
import { comSelo } from "./lib/selo.js";
import { t } from "./lib/textos.js";
import { iniciarVigia } from "./lib/aluguel.js";
import { iniciarPagamentos } from "./comandos/aluguel.js";
import { aoReceber, marcarEnviada, metaEmCache } from "./mensagens.js";
import { aoMudarParticipantes } from "./eventos.js";

const PASTA_SESSAO = path.resolve("sessao");
const silencioso = pino({ level: "silent" });
let tentativas = 0;
let numeroPareamento = "";
let codigoPedido = false;
let vigia = null;
const guardadas = new Map();
function guardar(id, m) {
  if (!id || !m) return;
  guardadas.set(id, m);
  if (guardadas.size > 800) guardadas.delete(guardadas.keys().next().value);
}

function perguntar(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, (r) => { rl.close(); resolve(r.trim()); });
  });
}

export async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
  let versao;
  try { versao = (await fetchLatestBaileysVersion()).version; } catch {}

  let usandoCodigo = false;
  let pedindo = false;
  if (!state.creds.registered) {
    let numero = numeroPareamento || soNumero(cfg().numeroBot);
    if (!numero && process.stdin.isTTY) numero = soNumero(await perguntar("📱 Número do bot com DDI e DDD (ex: 5511999999999), ou Enter para usar QR Code: "));
    if (numero && (numero.length === 10 || numero.length === 11)) numero = `55${numero}`;
    if (numero && (numero.length < 12 || numero.length > 13)) {
      console.log(`⚠️ Número inválido: ${numero}. Use 55 + DDD + número, ex: 5511999999999`);
      numero = "";
    }
    numeroPareamento = numero;
    usandoCodigo = Boolean(numero);
  }
  const sock = makeWASocket({
    ...(versao ? { version: versao } : {}),
    logger: silencioso,
    browser: Browsers.macOS("Chrome"),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silencioso) },
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    keepAliveIntervalMs: 25_000,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    shouldIgnoreJid: (j) => String(j).endsWith("@broadcast") || String(j).endsWith("@newsletter"),
    getMessage: async (key) => guardadas.get(key?.id),
    cachedGroupMetadata: async (jid) => metaEmCache(jid),
  });

  const pedirCodigo = async () => {
    if (!usandoCodigo || pedindo || codigoPedido || state.creds.registered) return;
    pedindo = true;
    console.log(`📲 Gerando código para +${numeroPareamento}...`);
    for (let i = 1; i <= 3; i++) {
      try {
        const codigo = await sock.requestPairingCode(numeroPareamento);
        codigoPedido = true;
        console.log(`\n🔑 Código de pareamento: ${codigo?.match(/.{1,4}/g)?.join("-") || codigo}`);
        console.log("No WhatsApp: Aparelhos conectados > Conectar aparelho > Conectar com número de telefone");
        console.log("O código vale pouco tempo: digite rápido.\n");
        break;
      } catch (e) {
        console.log(`⚠️ Tentativa ${i}/3 falhou (${e.message}).`);
        await new Promise((r) => setTimeout(r, 3000 * i));
      }
    }
    pedindo = false;
  };

  globalThis.__sorasakiSock = sock;
  const enviar = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, conteudo, opcoes) => { const r = await enviar(jid, comSelo(jid, conteudo), opcoes); marcarEnviada(r?.key?.id); guardar(r?.key?.id, r?.message); return r; };
  const relay = sock.relayMessage.bind(sock);
  sock.relayMessage = async (jid, m, o = {}) => { marcarEnviada(o.messageId); guardar(o.messageId, m); const id = await relay(jid, m, o); marcarEnviada(id); return id; };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && usandoCodigo) pedirCodigo();
    if (qr && !usandoCodigo) {
      try { (await import("qrcode-terminal")).default.generate(qr, { small: true }); } catch {}
      console.log("📷 Escaneie o QR Code acima (ou coloque o número em numeroBot no config.json para usar código).");
    }
    if (connection === "open") {
      tentativas = 0;
      codigoPedido = false;
      clearInterval(vigia);
      vigia = iniciarVigia(sock, t);
      iniciarPagamentos(sock);
      console.log(`🌸 ${cfg().nomeBot} conectada como ${soNumero(sock.user?.id)}`);
    }
    if (connection === "close") {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut || codigo === 401) {
        console.log("🚪 Sessão encerrada no celular. Apague a pasta sessao e conecte de novo.");
        fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
        process.exit(0);
      }
      if (codigo === DisconnectReason.connectionReplaced || codigo === 440) {
        console.log("⚠️ Outra conexão abriu com este número. Encerrando.");
        process.exit(1);
      }
      if (!state.creds.registered) codigoPedido = false;
      tentativas++;
      const espera = Math.min(30_000, 2_000 * tentativas);
      console.log(`🔄 Conexão caiu (${codigo || "?"}). Reconectando em ${espera / 1000}s...`);
      setTimeout(iniciar, espera);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const msg of messages || []) {
      if (msg?.key?.fromMe) guardar(msg.key.id, msg.message);
      if (type !== "notify" && !msg?.key?.fromMe) continue;
      const ts = msg.messageTimestamp;
      const quando = Number(typeof ts?.toNumber === "function" ? ts.toNumber() : ts || 0);
      if (quando && Date.now() / 1000 - quando > 120) continue;
      const tratar = () => aoReceber(sock, msg).catch((e) => console.error("[mensagem]", e.message));
      if (msg.key.fromMe) setTimeout(tratar, 1500);
      else await tratar();
    }
  });

  sock.ev.on("group-participants.update", async (u) => {
    try { await aoMudarParticipantes(sock, u); } catch (e) { console.error("[grupo]", e.message); }
  });
}
