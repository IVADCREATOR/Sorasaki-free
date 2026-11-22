import { enviarComBotoes, imagemDoMenu } from "../lib/botoes.js";
import { cfg } from "../lib/config.js";

export const botoesLigados = () => Boolean(cfg().botoes);

export async function enviarBotao(sock, jid, { caption = "", mentions = [] } = {}, botoes = [], quoted) {
  const lista = [];
  for (const b of botoes || []) {
    if (b?.type === "list") lista.push({ texto: b.title || "Abrir", lista: (b.rowId || []).map((s) => ({ titulo: s.title, linhas: (s.options || []).map((o) => ({ titulo: o.title, descricao: o.body, id: o.command })) })) });
  }
  return enviarComBotoes(sock, jid, { texto: caption, botoes: lista, imagem: imagemDoMenu(), mencoes: mentions }, quoted);
}
