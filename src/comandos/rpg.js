import { LISTA_RPG, jogosLigados } from "../rpg/comandos.js";
import { mencoesDoTexto } from "../rpg/util.js";
import { soNumero } from "../lib/config.js";
import { t } from "../lib/textos.js";

export function contextoRpg(c, extra = {}) {
  const meta = c.meta || null;
  const pn = [c.autorAlt, c.autor].find((j) => String(j || "").endsWith("@s.whatsapp.net"));
  return {
    sock: c.sock,
    msg: c.msg,
    jid: c.jid,
    isGroup: c.isGroup,
    prefixo: c.prefixo,
    args: c.args || [],
    texto: c.texto || "",
    cmd: c.cmd,
    autorJid: c.autor,
    autorNum: soNumero(c.autor),
    autorPn: pn ? soNumero(pn) : soNumero(c.autor),
    nome: c.msg?.pushName || "",
    meta,
    ehDono: Boolean(c.isDono),
    ehEquipe: Boolean(c.isDono),
    papel: c.isDono ? "dono" : null,
    podeAdmin: Boolean(c.isAdmin),
    responder: (texto, mencoes = []) => c.sock.sendMessage(c.jid, { text: texto, mentions: mencoes?.length ? mencoes : mencoesDoTexto(texto, meta) }, { quoted: c.msg }),
    reagir: (e) => c.sock.sendMessage(c.jid, { react: { text: e, key: c.msg.key } }).catch(() => {}),
    ...extra,
  };
}

export default LISTA_RPG.map((d) => ({
  nomes: d.nomes,
  categoria: "rpg",
  grupo: Boolean(d.grupo),
  admin: Boolean(d.admin),
  dono: Boolean(d.dono || d.equipe),
  semAluguel: false,
  run: async (c) => {
    if (d.jogo && c.isGroup && !jogosLigados(c.jid)) return c.reply(t("jogosOff", { p: c.prefixo }));
    const { COMANDOS } = await import("./index.js");
    return d.run(contextoRpg(c, { __free: { COMANDOS, contexto: c } }));
  },
}));
