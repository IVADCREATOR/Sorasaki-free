const LINHA = "━━━━━━━━━━━━━━━━━━━━";
const topo = (emoji, titulo) => `╭━━━〔 ${emoji} ${titulo} 〕━━━╮`;
const fim = () => `╰${LINHA}╯`;
const secao = (emoji, titulo, comandos, pre, marca = "✦") =>
  `┣${LINHA}\n┃\n┃ ${emoji} ${titulo}\n${comandos.map((c) => `┃ ${marca} ${pre}${c}`).join("\n")}\n┃`;
const rodape = (...linhas) => linhas.map((l) => `┃ ${l}`).join("\n");

export const fonteHina = (t) => String(t);
export const curtoHina = (titulo, nome = "", emoji = "💜") => `${emoji} ${titulo}${nome ? ` · ${nome}` : ""}`;

export const menuDeSecoes = (emoji, titulo, saudacao, secoes, pre, tem, rodapeExtra = null) => [
  topo(emoji, titulo),
  "┃",
  ...saudacao.map((l) => `┃ ${l}`),
  "┃",
  ...secoes.filter(([, , c]) => c.length).map(([e, t, c, marca]) => secao(e, t, c, pre, marca)),
  rodape(...(rodapeExtra ? [rodapeExtra] : []), `✦ ${pre}menu ⇒ voltar ao início`, ""),
  fim(),
].join("\n");
