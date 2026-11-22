import fs from "node:fs";
import path from "node:path";
import { soNumero } from "../lib/config.js";
import { t } from "../lib/textos.js";

const BN = { categoria: "brincadeiras" };
const sortear = (l) => l[Math.floor(Math.random() * l.length)];
const pct = () => Math.floor(Math.random() * 101);
const membros = (c) => (c.meta?.participants || []).map((p) => p.id).filter((i) => soNumero(i) !== soNumero(c.sock.user?.id));

const PIADAS = [
  "Por que o celular foi ao médico? Porque estava com a bateria fraca.",
  "O que o zero disse pro oito? Que cinto bonito!",
  "Por que o computador foi preso? Porque executou um programa.",
  "Qual é o peixe que caiu do 10º andar? O aaaaaaatum!",
  "O que a impressora falou pra outra? Essa folha é sua ou é impressão minha?",
  "Por que o livro de matemática ficou triste? Porque tinha muitos problemas.",
  "Qual é o café mais perigoso do mundo? O ex-presso.",
  "O que o pato falou pra pata? Vem quá!",
  "Por que a vaca foi pro espaço? Pra se encontrar com a vaca láctea.",
  "Qual é a fruta que anda de trem? O kiwiiii.",
];
const RESPOSTAS = ["Sim.", "Não.", "Com certeza!", "Nem a pau.", "Talvez...", "Pergunta de novo mais tarde.", "Os astros dizem que sim.", "Melhor não contar agora.", "Claro que sim!", "Jamais."];
const VERDADES = ["Qual foi a maior mentira que você já contou?", "Quem do grupo você acha mais engraçado?", "Qual foi seu maior mico?", "Você já stalkeou alguém daqui?", "Qual seu maior medo?", "Qual foi a última coisa que você pesquisou?"];
const DESAFIOS = ["Mande um áudio cantando 10 segundos.", "Mude sua foto por 1 hora pra uma que o grupo escolher.", "Fale só com emojis pelas próximas 5 mensagens.", "Elogie a última pessoa que mandou mensagem.", "Mande a última foto da sua galeria (que dá pra mandar 😅).", "Conte uma piada ruim agora."];

const termometro = (nome, emoji) => ({
  nomes: [nome], ...BN, grupo: true, desc: "@membro",
  run: async (c) => {
    const quem = c.alvo() || c.autor;
    return c.reply(`${emoji} @${soNumero(quem)} é *${pct()}%* ${nome}`, [quem]);
  },
});

const PASTA_GIFS = path.resolve("assets/acoes");

async function enviarGif(c, gifs, texto, mentions) {
  const ok = (gifs || []).filter((g) => fs.existsSync(path.join(PASTA_GIFS, `${g}.mp4`)));
  if (ok.length) {
    const video = fs.readFileSync(path.join(PASTA_GIFS, `${sortear(ok)}.mp4`));
    const r = await c.sock.sendMessage(c.jid, { video, gifPlayback: true, caption: texto, mentions }, { quoted: c.msg }).catch(() => null);
    if (r) return r;
  }
  return c.reply(texto, mentions);
}

const interacao = (nomes, emoji, frases, gifs = []) => ({
  nomes, ...BN, grupo: true, desc: "@membro",
  run: async (c) => {
    const quem = c.alvo();
    if (!quem) return c.reply(t("marqueAlguem"));
    return enviarGif(c, gifs, `${emoji} @${soNumero(c.autor)} ${sortear(frases)} @${soNumero(quem)}`, [c.autor, quem]);
  },
});

export default [
  {
    nomes: ["ship", "casal"], ...BN, grupo: true, desc: "@a @b",
    run: async (c) => {
      const lista = membros(c);
      const a = c.alvo() || sortear(lista);
      const b = sortear(lista.filter((x) => x !== a)) || c.autor;
      const n = pct();
      const barra = "❤️".repeat(Math.round(n / 20)) + "🤍".repeat(5 - Math.round(n / 20));
      return c.reply(`💘 @${soNumero(a)} + @${soNumero(b)}\n${barra} *${n}%*`, [a, b]);
    },
  },
  {
    nomes: ["sorteio", "sortear"], ...BN, grupo: true,
    run: async (c) => {
      const quem = sortear(membros(c));
      return c.reply(`🎉 @${soNumero(quem)} foi sorteado(a)!`, [quem]);
    },
  },
  {
    nomes: ["rankzoeira"], ...BN, grupo: true, desc: "tema",
    run: async (c) => {
      const tema = c.texto || "mais legais";
      const top = [...membros(c)].sort(() => Math.random() - 0.5).slice(0, 5);
      const med = ["🥇", "🥈", "🥉", "4.", "5."];
      return c.reply(`🏆 *Rank ${tema}*\n\n${top.map((q, i) => `${med[i]} @${soNumero(q)}`).join("\n")}`, top);
    },
  },
  {
    nomes: ["chance"], ...BN, desc: "pergunta",
    run: async (c) => c.reply(`🎲 ${c.texto ? `${c.texto}: ` : ""}*${pct()}%*`),
  },
  {
    nomes: ["pergunta", "8ball"], ...BN, desc: "pergunta",
    run: async (c) => c.reply(`🔮 ${sortear(RESPOSTAS)}`),
  },
  { nomes: ["dado"], ...BN, run: async (c) => c.reply(`🎲 Caiu *${1 + Math.floor(Math.random() * 6)}*`) },
  { nomes: ["moeda", "caraoucoroa"], ...BN, run: async (c) => c.reply(`🪙 Deu *${Math.random() < 0.5 ? "cara" : "coroa"}*`) },
  { nomes: ["piada"], ...BN, run: async (c) => c.reply(`😂 ${sortear(PIADAS)}`) },
  { nomes: ["verdade"], ...BN, run: async (c) => c.reply(`🤔 ${sortear(VERDADES)}`) },
  { nomes: ["desafiar"], ...BN, run: async (c) => c.reply(`🔥 ${sortear(DESAFIOS)}`) },
  termometro("gado", "🐂"),
  termometro("bonito", "✨"),
  termometro("chato", "😒"),
  termometro("inteligente", "🧠"),
  termometro("sortudo", "🍀"),
  interacao(["abracar", "abraco", "abraço"], "🤗", ["deu um abraço apertado em", "abraçou com força", "deu aquele abraço de reencontro em"], ["abraco"]),
  interacao(["beijarb", "beijoboca"], "💋", ["deu um beijo na boca de", "roubou um beijão de", "puxou pra perto e beijou"], ["beijarb"]),
  interacao(["selinho"], "😚", ["deu um selinho em", "roubou um selinho rapidinho de", "deu um selinho tímido em"], ["beijarb", "beijar-testa"]),
  interacao(["beijar", "beijotesta"], "😙", ["deu um beijinho na testa de", "segurou o rosto e beijou a testa de", "deu um beijo carinhoso na testa de"], ["beijar-testa"]),
  interacao(["colo"], "🥰", ["deitou no colo de", "pediu colo pra", "tirou um cochilo no colo de"], ["colo"]),
  interacao(["consolar"], "🥺", ["foi consolar", "secou as lágrimas de", "deu um ombro amigo pra"], ["consolar"]),
  interacao(["soco", "socar"], "🥊", ["deu um soco de mentirinha em", "acertou um gancho em", "partiu pra cima de"], ["soco"]),
  interacao(["chute", "chutar"], "🦵", ["deu uma voadora em", "acertou um chute de kung fu em", "chutou (de mentira)"], ["chute"]),
  interacao(["matar"], "🔪", ["eliminou (no faz de conta)", "mandou pro respawn", "derrubou com um golpe final"], ["matar"]),
  interacao(["tapa"], "👋", ["deu um tapa em", "deu um tapão em", "estapeou"]),
  interacao(["cafune"], "🥰", ["fez cafuné em", "fez carinho na cabeça de"]),
  {
    nomes: ["chorar"], ...BN, grupo: true,
    run: async (c) => {
      const quem = c.alvo();
      const texto = quem && soNumero(quem) !== soNumero(c.autor)
        ? `😢 @${soNumero(c.autor)} está chorando por causa de @${soNumero(quem)}... 💔`
        : `😢 @${soNumero(c.autor)} ${sortear(["está chorando no cantinho...", "caiu no choro", "está precisando de um abraço agora"])}\n_Alguém usa ${c.prefixo}consolar aí_`;
      return enviarGif(c, ["chorar"], texto, quem ? [c.autor, quem] : [c.autor]);
    },
  },
];
