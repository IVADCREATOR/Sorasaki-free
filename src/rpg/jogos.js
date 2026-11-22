import { aleatorio, reagir } from "./util.js";
import { usuario, alvos } from "./grupos.js";
import { grupo, salvarGrupo } from "./dados.js";
import { somarXp as somarXpNiveis } from "./niveis.js";
const ultimaPartida = new Map();
async function somarXp(c, xp) {
  await somarXpNiveis(c, xp);
  const p = ultimaPartida.get(c.jid);
  ultimaPartida.delete(c.jid);
  try { await (await import("./economia.js")).premiarJogo?.(c, p); } catch {}
}
import { midia } from "./midias.js";
import { ANIMAIS, GARTIC } from "./midias-lista.js";
import { inteiro, embaralhar as embaralharLista } from "./sorte.js";

const PALAVRAS = [
  ["TECLADO", "você usa para digitar"], ["JANELA", "tem na parede e deixa a luz entrar"],
  ["CACHORRO", "late e abana o rabo"], ["GELADEIRA", "mantém a comida fria"],
  ["FOGUETE", "sobe e vai para o espaço"], ["BICICLETA", "duas rodas e pedal"],
  ["CHUVEIRO", "molha você de manhã"], ["SANDALIA", "calçado de verão"],
  ["GUITARRA", "instrumento de seis cordas"], ["ABACAXI", "fruta com coroa"],
  ["TARTARUGA", "anda devagar e carrega a casa"], ["PIPOCA", "estoura e vai pro cinema"],
  ["TRAVESSEIRO", "onde a cabeça descansa"], ["CALENDARIO", "mostra os dias do mês"],
  ["BOMBEIRO", "apaga incêndio"], ["BORRACHA", "apaga o que você escreveu"],
  ["MORANGO", "fruta vermelha pequena"], ["GIRASSOL", "flor que segue o sol"],
  ["ESCADA", "sobe de degrau em degrau"], ["MOCHILA", "carrega nas costas"],
  ["PINGUIM", "ave que não voa e vive no gelo"], ["CHOCOLATE", "doce feito de cacau"],
  ["RELOGIO", "marca as horas"], ["FLORESTA", "muitas árvores juntas"],
  ["CAMINHAO", "carrega carga pesada"], ["ESTRELA", "brilha no céu à noite"],
  ["SORVETE", "gelado e cremoso"], ["JACARE", "réptil de boca grande"],
  ["VIOLAO", "parecido com a guitarra, mas acústico"], ["MARTELO", "bate no prego"]
];

const QUIZ = [
  ["Qual é o maior planeta do Sistema Solar?", ["Terra", "Júpiter", "Saturno", "Marte"], 1],
  ["Quantos lados tem um hexágono?", ["5", "6", "7", "8"], 1],
  ["Qual é a capital do Japão?", ["Pequim", "Seul", "Tóquio", "Bangcoc"], 2],
  ["Qual desses animais é um mamífero?", ["Tubarão", "Golfinho", "Polvo", "Tartaruga"], 1],
  ["Em que continente fica o Egito?", ["Ásia", "Europa", "África", "Oceania"], 2],
  ["Quanto é 7 x 8?", ["54", "56", "58", "64"], 1],
  ["Qual é o metal líquido à temperatura ambiente?", ["Ferro", "Chumbo", "Mercúrio", "Cobre"], 2],
  ["Qual é o oceano mais extenso?", ["Atlântico", "Índico", "Ártico", "Pacífico"], 3],
  ["Quem escreveu *Dom Casmurro*?", ["Machado de Assis", "José de Alencar", "Jorge Amado", "Clarice Lispector"], 0],
  ["Qual é a moeda oficial do Brasil?", ["Peso", "Real", "Escudo", "Cruzeiro"], 1],
  ["Quantos minutos tem uma hora e meia?", ["80", "90", "100", "120"], 1],
  ["Qual gás nós respiramos para viver?", ["Hidrogênio", "Oxigênio", "Nitrogênio", "Hélio"], 1],
  ["Qual é o menor número primo?", ["0", "1", "2", "3"], 2],
  ["Qual país sediou a Copa do Mundo de 2014?", ["África do Sul", "Rússia", "Brasil", "Catar"], 2],
  ["Quantas cordas tem um violino?", ["3", "4", "5", "6"], 1]
];

const FRASES_DIGITACAO = [
  "a hina organiza o grupo enquanto voce descansa",
  "quem respeita as regras aproveita melhor a conversa",
  "sorasaki cuida do seu grupo todos os dias",
  "digitar rapido e bom mas digitar certo e melhor",
  "o bot nunca dorme e sempre responde na hora",
  "grupo organizado rende conversa de qualidade"
];

const BONECO = [
  "┌───┐\n│   │\n│\n│\n│\n┴",
  "┌───┐\n│   │\n│   O\n│\n│\n┴",
  "┌───┐\n│   │\n│   O\n│   │\n│\n┴",
  "┌───┐\n│   │\n│   O\n│  /│\n│\n┴",
  "┌───┐\n│   │\n│   O\n│  /│\\\n│\n┴",
  "┌───┐\n│   │\n│   O\n│  /│\\\n│  /\n┴",
  "┌───┐\n│   │\n│   O\n│  /│\\\n│  / \\\n┴"
];

const partidas = new Map();
const LIMITE_MS = 5 * 60_000;

export function jogosLigados(jid) {
  const g = grupo(jid);
  return !g || g.jogos !== false;
}
export function definirJogos(jid, valor) {
  const g = grupo(jid);
  if (!g) return;
  g.jogos = Boolean(valor);
  salvarGrupo(jid);
}

function encerrar(jid) {
  const p = partidas.get(jid);
  if (p) ultimaPartida.set(jid, p);
  if (p?.timer) clearTimeout(p.timer);
  partidas.delete(jid);
}
function abrir(jid, dados, sock) {
  encerrar(jid);
  const p = { ...dados, expira: Date.now() + LIMITE_MS };
  p.timer = setTimeout(() => {
    if (partidas.get(jid) === p) {
      partidas.delete(jid);
      sock?.sendMessage(jid, { text: `⌛ A partida de *${dados.tipo}* acabou por tempo. Comece outra quando quiser.` }).catch(() => {});
    }
  }, LIMITE_MS);
  partidas.set(jid, p);
  return p;
}
export const partidaAberta = (jid) => partidas.get(jid) || null;
export const encerrarPartida = (jid) => encerrar(jid);

const semAcento = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const embaralhar = (p) => {
  const l = p.split("");
  for (let i = l.length - 1; i > 0; i--) { const j = inteiro(0, i); [l[i], l[j]] = [l[j], l[i]]; }
  const r = l.join("");
  return r === p ? embaralhar(p) : r;
};
const marca = (id) => `@${usuario(id)}`;

const C = [];
const def = (nomes, opc, run) => C.push({ nomes, ...opc, run });
const JOGO = { grupo: true };

function exigirLivre(c) {
  const p = partidas.get(c.jid);
  if (p) { c.responder(`⚠️ Já tem uma partida de *${p.tipo}* rolando aqui. Use *${c.prefixo}pararjogo* para encerrar.`); return false; }
  return true;
}

def(["pararjogo", "encerrarjogo"], { grupo: true, admin: true }, async (c) => {
  if (!partidas.has(c.jid)) return c.responder("Não tem jogo aberto aqui agora.");
  const t = partidas.get(c.jid).tipo;
  encerrar(c.jid);
  return c.responder(`🛑 Partida de *${t}* encerrada por ${c.nome}.`);
});

def(["forca"], JOGO, async (c) => {
  if (!exigirLivre(c)) return;
  const [palavra, dica] = aleatorio(PALAVRAS);
  const p = abrir(c.jid, { tipo: "forca", palavra, dica, achadas: new Set(), erros: 0, placar: new Map() }, c.sock);
  return c.responder(telaForca(p, c.prefixo));
});

function telaForca(p, prefixo) {
  const mostrado = p.palavra.split("").map((l) => (p.achadas.has(l) ? l : "_")).join(" ");
  return `🎯 *FORCA DA HINA*\n\n${BONECO[p.erros]}\n\n\`${mostrado}\`\n\n💡 Dica: ${p.dica}\n❌ Erros: ${p.erros}/6\n\n_Mande uma letra, ou \`${prefixo}forca palavra\` para chutar tudo._`;
}

export async function tentarForca(c, entrada) {
  const p = partidas.get(c.jid);
  if (!p || p.tipo !== "forca") return false;
  const texto = semAcento(entrada).trim();
  const chute = texto.replace(/^[^A-Z]*/, "");
  if (/^[A-Z]$/.test(chute)) {
    if (p.achadas.has(chute) || p.erradas?.has?.(chute)) return false;
    if (p.palavra.includes(chute)) {
      p.achadas.add(chute);
      p.placar.set(usuario(c.autorJid), (p.placar.get(usuario(c.autorJid)) || 0) + 1);
      if (p.palavra.split("").every((l) => p.achadas.has(l))) {
        encerrar(c.jid);
        await somarXp(c, 25);
        await c.responder(`🎉 *Acertaram!* A palavra era *${p.palavra}*.\nÚltima letra foi de ${marca(c.autorJid)}. +25 XP!`, [c.autorJid]);
        return true;
      }
      await c.responder(telaForca(p, c.prefixo));
      return true;
    }
    (p.erradas ||= new Set()).add(chute);
    p.erros += 1;
    if (p.erros >= 6) {
      encerrar(c.jid);
      await c.responder(`💀 *Enforcou!* A palavra era *${p.palavra}*.\n\n${BONECO[6]}`);
      return true;
    }
    await c.responder(telaForca(p, c.prefixo));
    return true;
  }
  return false;
}

def(["anagrama"], JOGO, async (c) => {
  if (!exigirLivre(c)) return;
  const [palavra, dica] = aleatorio(PALAVRAS);
  abrir(c.jid, { tipo: "anagrama", palavra, dica }, c.sock);
  return c.responder(`🔤 *ANAGRAMA DA HINA*\n\nDesembaralhe: \`${embaralhar(palavra)}\`\n💡 Dica: ${dica}\n\n_Mande a palavra aqui no grupo. Você tem 5 minutos._`);
});

def(["quiz"], JOGO, async (c) => {
  if (!exigirLivre(c)) return;
  const [pergunta, opcoes, certa] = aleatorio(QUIZ);
  abrir(c.jid, { tipo: "quiz", certa, opcoes }, c.sock);
  const letras = ["A", "B", "C", "D"];
  const lista = opcoes.map((o, i) => `${letras[i]}) ${o}`).join("\n");
  return c.responder(`🧠 *QUIZ DA HINA*\n\n${pergunta}\n\n${lista}\n\n_Responda com a letra (A, B, C ou D)._`);
});

def(["digitar", "digitacao"], JOGO, async (c) => {
  if (!exigirLivre(c)) return;
  const frase = aleatorio(FRASES_DIGITACAO);
  await c.responder("⌨️ *CORRIDA DE DIGITAÇÃO*\n\nPrepare-se... a frase vem em 3 segundos!");
  setTimeout(() => {
    abrir(c.jid, { tipo: "digitar", frase, inicio: Date.now() }, c.sock);
    c.responder(`⌨️ Digite exatamente:\n\n\`${frase}\``).catch(() => {});
  }, 3000);
});

def(["velha", "jogodavelha"], JOGO, async (c) => {
  if (!exigirLivre(c)) return;
  const rival = alvos(c.msg, c.meta, c.args)[0];
  if (!rival) return c.responder(`Marque o adversário: *${c.prefixo}velha @fulano*`);
  if (usuario(rival) === usuario(c.autorJid)) return c.responder("Jogar sozinho não tem graça. 😅");
  const p = abrir(c.jid, { tipo: "velha", casas: Array(9).fill(null), jogadores: [c.autorJid, rival], vez: 0 }, c.sock);
  return c.responder(telaVelha(p), p.jogadores);
});

function telaVelha(p) {
  const s = ["❌", "⭕"];
  const n = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  const grade = p.casas.map((v, i) => (v === null ? n[i] : s[v])).reduce((ac, v, i) => ac + v + (i % 3 === 2 ? "\n" : ""), "");
  return `🎮 *JOGO DA VELHA*\n\n${grade}\n❌ ${marca(p.jogadores[0])}\n⭕ ${marca(p.jogadores[1])}\n\n➡️ Vez de ${marca(p.jogadores[p.vez])} — mande o número da casa.`;
}
const LINHAS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

const soLetras = (t) => semAcento(t).replace(/[^A-Z0-9]/g, "");

async function cartaComFoto(lista) {
  const fila = embaralharLista(lista).slice(0, 3);
  for (const carta of fila) {
    const m = await midia(carta.chave).catch(() => null);
    if (m?.tipo === "img") return { carta, foto: m.dado };
  }
  return null;
}

async function abrirComFoto(c, tipo, lista, legenda) {
  if (!exigirLivre(c)) return;
  const achou = await cartaComFoto(lista);
  if (!achou) return c.responder("📵 Não consegui carregar as fotos desse jogo agora. Tente de novo daqui a pouco.");
  if (!exigirLivre(c)) return;
  const { carta, foto } = achou;
  abrir(c.jid, { tipo, resposta: carta.resposta, alvo: soLetras(carta.resposta) }, c.sock);
  try {
    await c.sock.sendMessage(c.jid, { image: foto, caption: legenda(carta) }, { quoted: c.msg });
  } catch {
    encerrar(c.jid);
    return c.responder("📵 A foto não quis sair. Tente de novo.");
  }
}

const dicaLetras = (r) => `${r.length} caracteres, começa com *${r[0]}*`;

def(["qualanimal", "animal", "adivinheanimal"], JOGO, async (c) =>
  abrirComFoto(c, "qual é o animal", ANIMAIS, (a) =>
    `🐾 *QUAL É O ANIMAL?*\n\n💡 ${dicaLetras(a.resposta)}\n\n_Mande o nome aqui no grupo. Vale 15 XP!_`));

def(["gartic", "adivinha", "adivinhe"], JOGO, async (c) =>
  abrirComFoto(c, "gartic", GARTIC, (g) =>
    `🎨 *GARTIC DA HINA*\n\n📂 Categoria: *${g.categoria}*\n💡 ${dicaLetras(g.resposta)}\n\n_O que é isso? Mande a resposta aqui. Vale 20 XP!_`));

export async function respostaDeJogo(c, texto) {
  const p = partidas.get(c.jid);
  if (!p) return false;
  const t = String(texto || "").trim();
  if (!t) return false;

  if (p.tipo === "forca") return tentarForca(c, t);

  if (p.tipo === "anagrama") {
    if (semAcento(t) !== p.palavra) return false;
    encerrar(c.jid);
    await somarXp(c, 20);
    await c.responder(`🎉 ${marca(c.autorJid)} acertou! Era *${p.palavra}*. +20 XP!`, [c.autorJid]);
    return true;
  }

  if (p.tipo === "quiz") {
    const letra = semAcento(t).replace(/[^A-D]/g, "");
    if (letra.length !== 1) return false;
    const i = "ABCD".indexOf(letra);
    if (i !== p.certa) { await c.responder(`❌ ${marca(c.autorJid)}, não é essa. Tente de novo!`, [c.autorJid]); return true; }
    encerrar(c.jid);
    await somarXp(c, 15);
    await c.responder(`✅ ${marca(c.autorJid)} acertou! Resposta: *${p.opcoes[p.certa]}*. +15 XP!`, [c.autorJid]);
    return true;
  }

  if (p.tipo === "digitar") {
    if (semAcento(t) !== semAcento(p.frase)) return false;
    const seg = ((Date.now() - p.inicio) / 1000).toFixed(1);
    encerrar(c.jid);
    await somarXp(c, 20);
    await c.responder(`⌨️ ${marca(c.autorJid)} digitou certinho em *${seg}s*! +20 XP!`, [c.autorJid]);
    return true;
  }

  if (p.tipo === "qual é o animal" || p.tipo === "gartic") {
    if (soLetras(t) !== p.alvo) return false;
    const xp = p.tipo === "gartic" ? 20 : 15;
    encerrar(c.jid);
    await somarXp(c, xp);
    await c.responder(`🎉 ${marca(c.autorJid)} acertou! Era *${p.resposta}*. +${xp} XP!`, [c.autorJid]);
    return true;
  }

  if (p.tipo === "velha") {
    const casa = Number(t) - 1;
    if (!Number.isInteger(casa) || casa < 0 || casa > 8) return false;
    if (usuario(c.autorJid) !== usuario(p.jogadores[p.vez])) return false;
    if (p.casas[casa] !== null) { await c.responder("Essa casa já foi usada."); return true; }
    p.casas[casa] = p.vez;
    const venceu = LINHAS.some((l) => l.every((i) => p.casas[i] === p.vez));
    if (venceu) {
      const campeao = p.jogadores[p.vez];
      encerrar(c.jid);
      await somarXp(c, 20);
      await c.responder(`🏆 ${marca(campeao)} venceu o jogo da velha!`, [campeao]);
      return true;
    }
    if (p.casas.every((v) => v !== null)) {
      encerrar(c.jid);
      await c.responder("🤝 Deu velha! Ninguém venceu.");
      return true;
    }
    p.vez = p.vez === 0 ? 1 : 0;
    await c.responder(telaVelha(p), p.jogadores);
    return true;
  }
  return false;
}

export const COMANDOS_JOGOS = C;
export const TOTAL_JOGOS = C.length;
