import { registrarMensagem, estaAfk, tirarAfk } from "./niveis.js";
import { aoSubirNivel } from "./rpg.js";
import { respostaDeJogo, jogosLigados } from "./jogos.js";
import { receberVotoEnquete } from "./economia.js";
import { usuario } from "./grupos.js";
import { mencoesDoTexto } from "./util.js";

const avisosAfk = new Map();

export async function votoEnquete(sock, msg, m) {
  await receberVotoEnquete(sock, msg, m).catch(() => {});
}

export async function convivencia({ sock, msg, jid, autor, nome, texto, meta, prefixo, ehComando, mencionados = [] }) {
  const falar = (t, mentions = []) => sock.sendMessage(jid, { text: t, mentions: mentions.length ? mentions : mencoesDoTexto(t, meta) }, { quoted: msg });
  const voltou = tirarAfk(jid, autor);
  if (voltou) await falar(`👋 @${usuario(autor)} voltou! Estava fora: ${voltou.motivo}`, [autor]);
  for (const alvo of mencionados.slice(0, 5)) {
    const a = estaAfk(jid, alvo);
    const k = `${jid}|${usuario(alvo)}`;
    if (a && Date.now() - (avisosAfk.get(k) || 0) > 5 * 60_000) {
      avisosAfk.set(k, Date.now());
      await falar(`😴 @${usuario(alvo)} está AFK.\n📝 ${a.motivo}`, [alvo]);
    }
  }
  const subiu = registrarMensagem(jid, autor);
  if (subiu) await aoSubirNivel({ jid, autorJid: autor, nivel: subiu, falar });
  if (!ehComando && texto && jogosLigados(jid)) {
    const ctx = { sock, msg, jid, autorJid: autor, autorNum: usuario(autor), nome, prefixo, meta, responder: falar };
    if (await respostaDeJogo(ctx, texto)) return true;
  }
  return false;
}
