import fs from "node:fs";
import path from "node:path";
import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from "baileys";
import { cfg } from "./config.js";
import { selo } from "./selo.js";
import { PASTA_DADOS } from "./banco.js";

export function imagemDoMenu() {
  const propria = path.join(PASTA_DADOS, "menu.jpg");
  if (fs.existsSync(propria)) return fs.readFileSync(propria);
  const padrao = path.resolve("assets/menu.jpg");
  return fs.existsSync(padrao) ? fs.readFileSync(padrao) : null;
}

function montar(botoes) {
  return botoes.map((b) => b.lista
    ? { name: "single_select", buttonParamsJson: JSON.stringify({ title: b.texto, sections: b.lista.map((s) => ({ title: s.titulo, rows: s.linhas.map((l) => ({ title: l.titulo, description: l.descricao || "", id: l.id })) })) }) }
    : b.url
    ? { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: b.texto, url: b.url, merchant_url: b.url }) }
    : { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: b.texto, id: b.id }) });
}

export async function enviarComBotoes(sock, jid, { texto, botoes = [], imagem = null, mencoes = [] }, quoted) {
  const c = cfg();
  if (c.botoes && botoes.length) {
    try {
      const midia = imagem ? await prepareWAMessageMedia({ image: imagem }, { upload: sock.waUploadToServer }) : null;
      const interativa = proto.Message.InteractiveMessage.create({
        body: { text: texto },
        footer: { text: c.rodape || c.nomeBot },
        header: midia?.imageMessage ? { hasMediaAttachment: true, imageMessage: midia.imageMessage } : { hasMediaAttachment: false, title: "" },
        contextInfo: { ...selo(), mentionedJid: mencoes, ...(quoted ? { stanzaId: quoted.key.id, participant: quoted.key.participant || quoted.key.remoteJid, quotedMessage: quoted.message } : {}) },
        nativeFlowMessage: { buttons: montar(botoes), messageParamsJson: "" },
      });
      const m = generateWAMessageFromContent(jid, { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, interactiveMessage: interativa } } }, { userJid: sock.user?.id });
      await sock.relayMessage(jid, m.message, {
        messageId: m.key.id,
        additionalNodes: [{ tag: "biz", attrs: {}, content: [{ tag: "interactive", attrs: { type: "native_flow", v: "1" }, content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }] }] }],
      });
      return;
    } catch (e) {
      console.error("[botões] enviando em texto:", e.message);
    }
  }
  const lista = botoes.filter((b) => b.id && !b.lista).map((b) => `▸ ${b.id}`).join("\n");
  const final = lista ? `${texto}\n\n${lista}` : texto;
  if (imagem) return sock.sendMessage(jid, { image: imagem, caption: final, mentions: mencoes }, { quoted });
  return sock.sendMessage(jid, { text: final, mentions: mencoes }, { quoted });
}

export function respostaDeBotao(m) {
  try {
    const p = m?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (p) return JSON.parse(p).id || "";
  } catch {}
  return m?.buttonsResponseMessage?.selectedButtonId || m?.listResponseMessage?.singleSelectReply?.selectedRowId || m?.templateButtonReplyMessage?.selectedId || "";
}
