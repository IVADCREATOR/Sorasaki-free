export const CANAL = {
  nome: "Sorasaki • Avisos & Updates",
  jid: "120363427087795867@newsletter",
  link: "https://whatsapp.com/channel/0029VbDgYzOL2AU7jRJrN304",
};

export const selo = () => ({
  isForwarded: true,
  forwardingScore: 1,
  forwardedNewsletterMessageInfo: { newsletterJid: CANAL.jid, newsletterName: CANAL.nome, serverMessageId: -1 },
});

const TIPOS = ["text", "image", "video", "document"];

export function comSelo(jid, conteudo) {
  if (String(jid).endsWith("@newsletter") || !conteudo || typeof conteudo !== "object" || conteudo.edit) return conteudo;
  if (!TIPOS.some((k) => k in conteudo)) return conteudo;
  return { ...conteudo, contextInfo: { ...(conteudo.contextInfo || {}), ...selo() } };
}
