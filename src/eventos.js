import fs from "node:fs";
import path from "node:path";
import { grupo, salvarGrupo, PASTA_DADOS } from "./lib/banco.js";
import { t } from "./lib/textos.js";
import { soNumero } from "./lib/config.js";
import { grupoAtivo } from "./lib/aluguel.js";
import { esquecerGrupo, metaDoGrupo, participante, naListaNegra } from "./mensagens.js";

export const fotoPropriaBv = (jid) => path.join(PASTA_DADOS, "bemvindo", `${soNumero(jid)}.jpg`);

function preencher(modelo, vars) {
  let texto = modelo;
  for (const [k, v] of Object.entries(vars)) texto = texto.split(`{${k}}`).join(String(v));
  return texto;
}

async function fotoDe(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, "image");
    return url ? { url } : null;
  } catch {
    return null;
  }
}

export async function enviarBemVindo(sock, id, quem, meta, g, saida = false) {
  const vars = {
    user: soNumero(quem),
    grupo: meta?.subject || "",
    membros: meta?.participants?.length || "",
    desc: meta?.desc || "",
  };
  const modelo = saida ? (g.legendasaiu || t("saiu")) : (g.legendabv || t("bemvindo"));
  const texto = preencher(modelo, vars);

  let imagem = null;
  if (!saida) {
    const modo = g.fotobv || "perfil";
    if (modo === "propria" && fs.existsSync(fotoPropriaBv(id))) imagem = fs.readFileSync(fotoPropriaBv(id));
    else if (modo === "perfil") imagem = (await fotoDe(sock, quem)) || (await fotoDe(sock, id));
    else if (modo === "grupo") imagem = await fotoDe(sock, id);
  }

  if (imagem) {
    const ok = await sock.sendMessage(id, { image: imagem, caption: texto, mentions: [quem] }).catch(() => null);
    if (ok) return;
  }
  await sock.sendMessage(id, { text: texto, mentions: [quem] }).catch(() => {});
}

export async function aoMudarParticipantes(sock, { id, participants = [], action }) {
  esquecerGrupo(id);
  if (!["add", "remove"].includes(action) || !grupoAtivo(id)) return;
  const g = grupo(id);
  const meta = await metaDoGrupo(sock, id);
  const bot = participante(meta, sock.user?.id, sock.user?.lid);

  for (const p of participants) {
    const quem = typeof p === "string" ? p : p?.id || p?.phoneNumber;
    if (!quem || soNumero(quem) === soNumero(sock.user?.id)) continue;
    const ids = [quem, p?.phoneNumber, p?.lid, p?.jid].filter(Boolean).map(soNumero);

    if (action === "add" && naListaNegra(g, ids)) {
      if (bot?.admin) {
        await sock.groupParticipantsUpdate(id, [quem], "remove").catch(() => {});
        await sock.sendMessage(id, { text: t("listaNegraRemovido", { user: soNumero(quem) }), mentions: [quem] }).catch(() => {});
      }
      continue;
    }
    if (!g.bemvindo) continue;
    await enviarBemVindo(sock, id, quem, meta, g, action === "remove");
  }
  salvarGrupo();
}
