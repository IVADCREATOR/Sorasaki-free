import { CONFIG } from "./config.js";
import { usuario } from "./grupos.js";
import { enviarBotao } from "./botoes.js";
import { patente, niveisLigados, definirNiveis, membro, nivelDoXp } from "./niveis.js";
import { t } from "../lib/textos.js";
import { menuDeSecoes } from "./textos.js";
import { cfgRpg, definirRpg, PADRAO_RPG, moedas, lembrarNomeDoGrupo, conta, patrimonio, ATIVOS_RPG, precoAcao, tetoGanho, valorGanho } from "./economia.js";

const escreverRelatorio = () => {};

const marca = (id) => `@${usuario(id)}`;

export async function aoSubirNivel({ jid, autorJid, nivel, falar }) {
  const cfg = cfgRpg(jid);
  const pt = patente(nivel);
  const mudouPatente = patente(nivel - 1).nome !== pt.nome;
  let premio = 0;
  try { premio = (await import("./economia.js")).pagarNivel(jid, autorJid, nivel); } catch {}
  if (premio && cfg.avisoNivel !== "todos") { await falar(`⭐ @${usuario(autorJid)} subiu para o *nível ${nivel}* e ganhou *🪙 ${premio.toLocaleString("pt-BR")}*!`, [autorJid]).catch(() => {}); return; }
  if (cfg.avisoNivel === "off") return;
  if (cfg.avisoNivel === "marcos" && nivel % 5 !== 0 && !mudouPatente) return;
  await falar(`${pt.emoji} @${usuario(autorJid)} subiu para o *nível ${nivel}* — ${pt.nome}!${premio ? `\n⭐ Ganhou *🪙 ${premio.toLocaleString("pt-BR")}*` : ""}`, [autorJid]).catch(() => {});
}

const C = [];
const def = (nomes, opc, run) => C.push({ nomes, ...opc, run });
const G = { grupo: true };
const ADM = { grupo: true, admin: true };
const sim = (v) => (v ? "🟢 ligado" : "🔴 desligado");
const AVISO = { todos: "todos os níveis", marcos: "só marcos (a cada 5 e nova patente)", off: "sem aviso" };

async function enviarMenu(c, texto, botoes) {
  const imagem = CONFIG.logo ? { url: CONFIG.logo } : null;
  return enviarBotao(c.sock, c.jid, { caption: texto, footer: CONFIG.nomeBot, image: imagem, mentions: [c.autorJid] }, botoes, c.msg);
}
const linha = (c, titulo, comando, corpo) => ({ title: titulo, body: corpo, command: `${c.prefixo}${comando}` });

function textoMenu(c) {
  const p = c.prefixo;
  const cfg = cfgRpg(c.jid);
  const m = conta(c.jid, c.autorJid);
  const nv = nivelDoXp(membro(c.jid, c.autorJid).xp);
  const pt = patente(nv);
  return `╭━━━〔 🎮 𝑹𝑷𝑮 𝑫𝑨 𝑯𝑰𝑵𝑨 〕━━━╮
┃ 👤 ${marca(c.autorJid)}
┃ ${pt.emoji} Nível ${nv} — ${pt.nome}
┃ 💎 Patrimônio: ${moedas(patrimonio(m))}
╰━━━━━━━━━━━━━━━━━━━━╯
🌐 _Sua carteira vale em todos os grupos da Hina e no privado dela (${p}carteira)._

💰 *ECONOMIA* ${cfg.economia ? "" : "(desligada)"}
┃ ${p}carteira · ${p}diario · ${p}trabalhar
┃ ${p}crime · ${p}banco · ${p}transferir @ valor
┃ ${p}depositar valor 💎 _(só VIP)_ · ${p}sacar valor — guardar/tirar do banco
┃ ${p}senhacriar · ${p}senhatrocar — senha do banco (no privado)${cfg.roubo ? `\n┃ ${p}roubar @ · ${p}assaltarbanco @ senha\n┃ ${p}assassino @ — assassino de aluguel` : ""}${cfg.emprestimo ? `\n┃ ${p}emprestar @ valor juros · ${p}pediremprestimo @ valor juros\n┃ ${p}emprestimo · ${p}pagardivida · ${p}perdoardivida @\n┃ ${p}aceitaremprestimo · ${p}recusaremprestimo · ${p}contraproposta` : ""}

👮 *CARREIRAS*
┃ ${p}carreiras · ${p}prender · ${p}condenar · ${p}soltar
┃ ${p}abater · ${p}procurados · ${p}fianca

🏛️ *BANCO CENTRAL*
┃ ${p}bancocentral · ${p}cartao · ${p}credito · ${p}fatura
┃ ${p}mercadonegro · ${p}arsenal · ${p}assaltarbc

🎯 *GANHAR JOGANDO* (sem apostar nada)
┃ ${p}comoganhar — todos os jeitos de ganhar
┃ ${p}desafio fácil/médio/difícil · ${p}r resposta
┃ ${p}missoes — 3 por dia + baú · ${p}metagrupo
┃ ${p}forca · ${p}quiz · ${p}anagrama · ${p}digitar — vencer dá moedas

🎰 *APOSTAS* ${cfg.apostas ? "" : "(desligadas)"}
┃ ${p}menuapostas — 15 jogos no cassino
┃ ${p}pausarapostas dias — dar um tempo

📈 *BOLSA* ${cfg.bolsa ? "" : "(desligada)"}
┃ ${p}menuacoes — tudo sobre a bolsa
┃ ${p}ações · ${p}investir · ${p}venderacao · ${p}minhasacoes
┃ ${p}historico SORA3 · ${p}comparar SORA3 HINA4

🐷 *INVESTIMENTOS* ${cfg.investir ? "" : "(desligados)"}
┃ ${p}poupanca — 0,2% ao dia, sem risco
┃ ${p}cdb — prazo de 7, 15 ou 30 dias
┃ ${p}dividendos · ${p}investimentos

🎣 *COLETAS* (sorte, de graça)
┃ ${p}pescar · ${p}minerar · ${p}cacar
┃ ${p}mochila · ${p}vendercoleta · ${p}alta (hospital)

🏘️ *PROPRIEDADES* ${cfg.loja ? "" : "(desligadas)"}
┃ ${p}loja · ${p}coletar · ${p}premium ⭐
┃ _Grandes: terreno, gado, plantação, haras, fazenda de gado e usina (a partir de 🪙 300 mil)_

🎨 *PERSONALIZAÇÃO*
┃ ${p}molduras · ${p}titulos · ${p}conquistas

📊 *ENQUETE DO DONO* (grátis, com prêmio)
┃ ${p}enquete — ver a pergunta e as regras
┃ ${p}votar 1 — votar (um voto, sem troca)

🏆 *RANKINGS*
┃ ${p}rankrico — mais ricos do grupo
┃ ${p}rank · ${p}perfil — níveis

💎 *VIP*
┃ ${p}meuvip · ${p}lembretes · ${p}cancelarlembrete

📜 *REGRAS*
┃ ${p}termosrpg — regras e riscos (leia antes de apostar)
┃ ${p}aceitotermos1 — aceitar os termos do RPG

⚙️ *ADMINS:* ${p}modorpg on/off · ${p}rpgconfig${c.ehEquipe ? `\n👑 *DONO:* ${p}menudonojogos (controle total) · ${p}menudono` : ""}
_⚠️ Apostas, bolsa e ações podem tirar moedas do seu saldo. Não há garantia de lucro. Moedas não têm saque._`;
}

const textoMenuApostas = (c, cfg) => menuDeSecoes("🎰", "𝑪𝑨𝑺𝑺𝑰𝑵𝑶 𝑫𝑨 𝑯𝑰𝑵𝑨", [
  `🌸 Olá, @${usuario(c.autorJid)}!`,
  `✦ 15 jogos · aposta a partir de ${moedas(10)}, sem limite`,
  "✦ Use: *apostar (jogo) (valor) (escolha)*",
], [
  ["🍀", "𝑺𝑶𝑹𝑻𝑬 𝑹𝑨́𝑷𝑰𝑫𝑨", ["apostar moeda 100 cara · 2×", "apostar dado 100 4 · 6×", "apostar dados 100 maior · 2× (sete 5×)", "apostar copos 100 2 · 3×", "apostar carta 100 · 2×", "apostar jokenpo 100 pedra · 2×"], "🎲"],
  ["🎡", "𝑪𝑨𝑺𝑺𝑰𝑵𝑶", ["apostar roleta 100 vermelho · 2× · verde 12× · número 36×", "apostar slot 100 · até 400×", "apostar raspadinha 100 · até 50×"], "🎰"],
  ["🏆", "𝑬𝑺𝑷𝑶𝑹𝑻𝑬𝑺", ["apostar corrida 100 3 · 5×", "apostar penalti 100 esquerda · 2×", "apostar arremesso 100 medio · 2× a 5×"], "⚽"],
  ["💥", "𝑨𝑳𝑻𝑶 𝑹𝑰𝑺𝑪𝑶", ["apostar foguete 100 2.5 · você escolhe", "apostar minas 100 3 · até 17×", "apostar cofre 100 7 · 10×"], "🚀"],
  ["📜", "𝑹𝑬𝑮𝑹𝑨𝑺", ["termosrpg — leia antes de apostar", "aceitotermos1 — aceitar", "pausarapostas 7 — dar um tempo"], "✦"],
], c.prefixo, null, `💡 Ganhou, recebe cheio: 100 num jogo de 2× vira 200\n┃ 💡 Valor: número, *1k*, *metade* ou *tudo* · 1 aposta a cada 5 s\n┃ 📉 Prêmio cheio, mas ganhar é difícil: em média os jogos\n┃    devolvem de 85% a 92% do apostado. Aposte só o que pode perder.`);

def(["menuapostas", "menucassino", "cassinomenu", "apostas", "jogosaposta"], G, async (c) => {
  lembrarNomeDoGrupo(c.jid, c.meta?.subject);
  const cfg = cfgRpg(c.jid);
  if (!cfg.economia || !cfg.apostas) return c.responder(`🚫 Apostas desligadas. Use ${c.prefixo}rpgconfig apostas 1`);
  setTimeout(() => c.reagir?.("🎰"), 300);
  const L = (t, cmd, d) => linha(c, t, cmd, d);
  return enviarMenu(c, textoMenuApostas(c, cfg), [{
    type: "list", title: "🎰 𝑱𝑶𝑮𝑨𝑹", rowId: [
      { title: "🍀 SORTE RÁPIDA", options: [L("🪙 Cara ou coroa", "apostar moeda 100 cara", "Paga 2×"), L("🎲 Dado", "apostar dado 100 4", "Acerte de 1 a 6 · 6× · tem face ☠️"), L("🎲🎲 Dados maior/menor", "apostar dados 100 maior", "2× · sete paga 5×"), L("🥤 Copos", "apostar copos 100 2", "Ache a bolinha · 3×"), L("🃏 Carta alta", "apostar carta 100", "Contra a Hina · 2× · cuidado com o coringa"), L("✊ Jokenpô", "apostar jokenpo 100 pedra", "Contra a Hina · 2×")] },
      { title: "🎡 CASSINO", options: [L("🎡 Roleta", "apostar roleta 100 vermelho", "Vermelho/preto 2× · verde 12× · número 36×"), L("🎰 Caça-níquel", "apostar slot 100", "Três 7️⃣ pagam 400×"), L("🎟️ Raspadinha", "apostar raspadinha 100", "Três 💎 pagam 50×")] },
      { title: "🏆 ESPORTES", options: [L("🏇 Corrida", "apostar corrida 100 3", "Cavalo de 1 a 5 · 5× · o da Hina também corre"), L("⚽ Pênalti", "apostar penalti 100 esquerda", "Gol paga 2×"), L("🏀 Arremesso", "apostar arremesso 100 medio", "Curto 2× · médio 3× · longo 5×")] },
      { title: "💥 ALTO RISCO", options: [L("🚀 Foguete", "apostar foguete 100 2.5", "Sai antes de explodir"), L("💣 Campo minado", "apostar minas 100 3", "Até 17×"), L("🔐 Cofre", "apostar cofre 100 7", "Acerte o dígito · 10×")] },
    ] }]);
});

def(["menurpg", "rpg", "menueconomia", "economia"], G, async (c) => {
  lembrarNomeDoGrupo(c.jid, c.meta?.subject);
  setTimeout(() => c.reagir("🎮"), 300);
  const cfg = cfgRpg(c.jid);
  return enviarMenu(c, textoMenu(c), [{
    type: "list", title: "🎮 𝑹𝑷𝑮 𝑫𝑨 𝑯𝑰𝑵𝑨", rowId: [
      { title: "💰 ECONOMIA", options: [
        linha(c, "👛 Minha carteira", "carteira", "Mão, banco, ações e propriedades"),
        linha(c, "🎁 Diário", "diario", "Recompensa a cada 24 h, com sequência"),
        linha(c, "💼 Trabalhar", "trabalhar", "Ganha moedas a cada 20 min"),
        linha(c, "🦹 Crime", "crime", `Arriscado: até ${moedas(tetoGanho("crime"))} ou paga multa`),
        linha(c, "🏦 Banco", "banco", "Guarde para não ser roubado (precisa de senha)"),
        linha(c, "🏛️ Banco Central", "bancocentral", "Cartão, crédito e mercado negro"),
        linha(c, "👮 Carreiras", "carreiras", "Polícia, juiz e BOPE: prenda, condene e abata"),
        linha(c, "🔐 Criar senha do banco", "senhacriar", "No privado da Hina"),
        linha(c, "🔁 Trocar senha do banco", "senhatrocar", "No privado da Hina"),
        ...(cfg.roubo ? [linha(c, "🏦🔓 Assaltar banco", "assaltarbanco", "Descubra a senha e leve 10% a 40%"), linha(c, "🔪 Assassino de aluguel", "assassino", "35% acerta · se for pego, multa de 1 a 5 mil")] : []),
        ...(cfg.emprestimo ? [linha(c, "🤝 Empréstimos", "emprestimo", "Quem deve, quem recebe e como negociar")] : [])
      ] },
      { title: "🎯 GANHAR JOGANDO", options: [
        linha(c, "💡 Como ganhar moedas", "comoganhar", "Todos os jeitos, sem apostar"),
        linha(c, "🎯 Desafios", "desafio", "Fácil, médio ou difícil: mais difícil, mais paga"),
        linha(c, "📜 Missões do dia", "missoes", `3 missões + baú de ${moedas(valorGanho("missoes", 676))}`),
        linha(c, "🤝 Meta do grupo", "metagrupo", "Todo mundo que ajuda ganha")
      ] },
      { title: "🎰 APOSTAS E BOLSA", options: [
        ...(cfg.apostas ? [linha(c, "🎰 Cassino", "menuapostas", "15 jogos: slot, roleta, minas, pênalti e mais"), linha(c, "🎁 Caixas misteriosas", "caixas", "De 10 mil a 3 mi: itens, moedas, propriedades e premium")] : []),
        ...(cfg.bolsa ? [linha(c, "📈 Menu de ações", "menuacoes", "Empresas, preços, riscos e comandos"), linha(c, "📈 Bolsa Sora", "bolsa", "Ações fictícias que sobem e descem"), linha(c, "📊 Minhas ações", "minhasacoes", "Lucro e prejuízo")] : []),
        ...(cfg.loja ? [linha(c, "🏘️ Propriedades", "loja", "Compre e receba renda todo dia"), linha(c, "💰 Coletar renda", "coletar", "Pega o que suas propriedades renderam"), linha(c, "⭐ Premium", "premium", "Renda fixa, nunca dá prejuízo (Pix)")] : []),
        ...(cfg.investir ? [linha(c, "🐷 Poupança", "poupanca", "0,2% ao dia, sem risco"), linha(c, "🏛️ CDB", "cdb", "Ganho garantido com prazo"), linha(c, "💼 Meus investimentos", "investimentos", "Poupança, CDB, ações e dividendos")] : [])
      ] },
      { title: "🎨 PERSONALIZAÇÃO", options: [
        linha(c, "🖼️ Molduras do perfil", "molduras", "Compra única, fica pra sempre"),
        linha(c, "🎖️ Títulos", "titulos", "Aparecem no perfil e no ranking"),
        linha(c, "🏅 Conquistas", "conquistas", "Metas com prêmio em moedas")
      ] },
      { title: "🏆 RANKINGS", options: [
        linha(c, "💎 Mais ricos do grupo", "rankrico", "Top 10 por patrimônio"),
        linha(c, "🏅 Ranking de níveis", "rank", "Top 10 por XP")
      ] },
      ...(c.podeAdmin ? [{ title: "⚙️ ADMINS", options: [linha(c, "⚙️ Configurar o RPG", "rpgconfig", "Ligar/desligar níveis, economia, apostas…")] }] : []),
      ...(c.ehEquipe ? [{ title: "👑 DONO", options: [linha(c, "👑 Menu do dono", "menudono", "Moedas, enquete, estorno e logs"), linha(c, "🎮 Controle dos jogos", "menudonojogos", "Preços, propriedades, premium, mercado e regras")] }] : [])
    ].filter((s) => s.options.length) }]);
});

const RISCO = { baixo: "🟢 baixo", "médio": "🟡 médio", alto: "🔴 alto" };
def(["menuacoes", "menuações", "menubolsa", "menuacao"], G, async (c) => {
  const p = c.prefixo;
  const cfg = cfgRpg(c.jid);
  const empresas = Object.entries(ATIVOS_RPG).map(([t, a]) => `┃ ${a.emoji} *${t}* — ${a.nome}\n┃    🪙 ${Math.round(precoAcao(t)).toLocaleString("pt-BR")} · risco ${RISCO[a.risco] || a.risco}${a.div ? " · 💰 paga dividendos" : ""}`).join("\n");
  const texto = `╭━━━〔 📈 𝑩𝑶𝑳𝑺𝑨 𝑺𝑶𝑹𝑨 〕━━━╮
┃ Ações fictícias: o preço muda a cada 10 min
╰━━━━━━━━━━━━━━━━━━━━╯${cfg.bolsa ? "" : "\n\n🔴 _A bolsa está desligada neste grupo (um admin liga no " + p + "rpgconfig)._"}

🏢 *EMPRESAS*
${empresas}

📊 *VER O MERCADO*
┃ ${p}ações — altas, quedas e estáveis
┃ ${p}historico SORA3 — gráfico das últimas horas
┃ ${p}comparar SORA3 HINA4 — lado a lado

💸 *COMPRAR E VENDER*
┃ ${p}investir SORA3 10 — compra 10 ações
┃ ${p}venderacao SORA3 5 — vende 5 (ou *tudo*)
┃ _Cada compra e venda tem taxa de 1%._

💼 *SUA CARTEIRA*
┃ ${p}minhasacoes — preço médio, atual e lucro/prejuízo
┃ ${p}dividendos — o que as pagadoras renderam
┃ ${p}investimentos — tudo junto (poupança, CDB e ações)

⚠️ _Ações sobem e descem: você pode perder moedas e não há garantia de lucro. Antes da primeira compra a Hina pede o ${p}aceitotermos1._`;
  return enviarMenu(c, texto, [{ type: "list", title: "📈 BOLSA SORA", rowId: [
    { title: "📊 MERCADO", options: [linha(c, "📊 Ver as ações", "ações", "Altas, quedas e estáveis"), linha(c, "💼 Minhas ações", "minhasacoes", "Lucro e prejuízo"), linha(c, "💰 Dividendos", "dividendos", "O que as pagadoras renderam")] },
    { title: "📈 HISTÓRICO", options: Object.entries(ATIVOS_RPG).map(([t, a]) => linha(c, `${a.emoji} ${t}`, `historico ${t}`, `${a.nome} · risco ${a.risco}`)) }
  ] }]);
});

const CHAVES = {
  niveis: { nome: "Níveis (XP)", ler: (jid) => niveisLigados(jid), gravar: (jid, v) => definirNiveis(jid, v) },
  economia: { nome: "Economia" }, apostas: { nome: "Apostas" }, bolsa: { nome: "Bolsa" }, loja: { nome: "Propriedades" }, investir: { nome: "Poupança, CDB e dividendos" },
  roubo: { nome: "Roubo entre membros" }, emprestimo: { nome: "Empréstimos entre membros" }
};
function painel(c) {
  const cfg = cfgRpg(c.jid);
  const p = `${c.prefixo}rpgconfig`;
  return `⚙️ *CONFIGURAÇÃO DO RPG*\n\n` +
    Object.entries(CHAVES).map(([k, d]) => `• ${d.nome}: ${sim(d.ler ? d.ler(c.jid) : cfg[d.campo || k])}\n   _${p} ${k} ${(d.ler ? d.ler(c.jid) : cfg[d.campo || k]) ? 0 : 1}_`).join("\n") +
    `\n• Aviso de nível: *${AVISO[cfg.avisoNivel] || cfg.avisoNivel}*\n   _${p} avisonivel todos | marcos | off_` +
    `\n• Aposta máxima: *sem limite*` +
    `\n• Transferência por dia: *${moedas(cfg.transferenciaDia)}* (3× para quem tem até 1/5 do seu patrimônio)\n   _${p} transfmax 20000_` +
    `\n• Empréstimo máximo: *sem limite*`;
}
def(["rpgconfig", "configrpg", "rpgcfg"], ADM, async (c) => {
  lembrarNomeDoGrupo(c.jid, c.meta?.subject);
  const [chave, valorBruto] = [String(c.args[0] || "").toLowerCase(), String(c.args[1] || "").toLowerCase()];
  if (!chave) {
    const cfg = cfgRpg(c.jid);
    const alternar = (k, nome) => {
      const d = CHAVES[k];
      const ligado = d.ler ? d.ler(c.jid) : cfg[d.campo || k];
      return linha(c, `${ligado ? "🔴 Desligar" : "🟢 Ligar"} ${nome}`, `rpgconfig ${k} ${ligado ? 0 : 1}`, `Agora: ${ligado ? "ligado" : "desligado"}`);
    };
    return enviarMenu(c, painel(c), [{ type: "list", title: "⚙️ CONFIGURAR", rowId: [
      { title: "NÍVEIS", options: [alternar("niveis", "níveis"), ...["todos", "marcos", "off"].filter((m) => m !== cfg.avisoNivel).map((m) => linha(c, `🔔 Aviso: ${AVISO[m]}`, `rpgconfig avisonivel ${m}`, "Mensagem quando alguém sobe de nível"))] },
      { title: "ECONOMIA", options: [alternar("economia", "economia"), alternar("apostas", "apostas"), alternar("bolsa", "bolsa"), alternar("investir", "investimentos"), alternar("loja", "propriedades"), alternar("roubo", "roubo"), alternar("emprestimo", "empréstimos")] }
    ] }]);
  }
  if (chave === "avisonivel") {
    if (!["todos", "marcos", "off"].includes(valorBruto)) return c.responder(`Use *${c.prefixo}rpgconfig avisonivel todos*, *marcos* ou *off*.`);
    definirRpg(c.jid, "avisoNivel", valorBruto);
    return c.responder(`🔔 Aviso de nível: *${AVISO[valorBruto]}*.${valorBruto !== "todos" ? "\n_O XP continua contando normalmente; só a mensagem muda._" : ""}`);
  }
  if (chave === "apostamax" || chave === "emprestimomax") return c.responder("♾️ Aposta e empréstimo agora são *sem limite* em todos os grupos.");
  const LIMITES = { apostamax: ["apostaMax", "Aposta máxima", 100], transfmax: ["transferenciaDia", "Transferência por dia", 0], emprestimomax: ["emprestimoMax", "Empréstimo máximo", 100] };
  if (LIMITES[chave]) {
    const [campo, nome, min] = LIMITES[chave];
    const max = 10_000_000;
    const n = Math.floor(Number(String(c.args[1] || "").replace(/\D/g, "")));
    if (!(n >= min && n <= max)) return c.responder(`Valor entre ${moedas(min)} e ${moedas(max)}.`);
    definirRpg(c.jid, campo, n);
    return c.responder(`✅ ${nome}: *${moedas(n)}*.`);
  }
  if (chave === "zerar") {
    return c.responder(`Use ${c.prefixo}zerarcarteira @membro confirmar`);
  }

  const d = CHAVES[chave];
  if (!d || !["0", "1", "on", "off"].includes(valorBruto)) return c.responder(painel(c));
  const v = valorBruto === "1" || valorBruto === "on";
  if (d.gravar) d.gravar(c.jid, v); else definirRpg(c.jid, d.campo || chave, v);
  if (["ranking", "economia"].includes(chave)) escreverRelatorio({ forcar: true });
  return c.responder(t(v ? "ativado" : "desativado"));
});

def(["modorpg"], ADM, async (c) => {
  const v = String(c.args[0] || "").toLowerCase();
  if (!["on", "off", "1", "0"].includes(v)) return c.responder(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
  const on = ["on", "1"].includes(v);
  definirRpg(c.jid, "economia", on);
  definirNiveis(c.jid, on);
  return c.responder(t(on ? "ativado" : "desativado"));
});

export const COMANDOS_RPG = C;
export { PADRAO_RPG };
