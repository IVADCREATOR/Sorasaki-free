import { ler, salvar } from "./banco.js";

export const PADRAO = {
  ativado: "✅ Comando ativado",
  desativado: "❌ Comando desativado",
  usoOnOff: "Para ativar: {p}{cmd} 1\nDesativar: {p}{cmd} 0",
  naoEncontrado: "Comando não encontrado no meu registro.",
  soGrupo: "Esse comando só funciona em grupo.",
  soAdmin: "Só administradores podem usar.",
  soDono: "Só o meu dono pode usar.",
  botAdmin: "Preciso ser administradora do grupo.",
  marqueAlguem: "Marque ou responda alguém.",
  feito: "✅ Feito.",
  erro: "⚠️ Deu erro, tente de novo.",
  removido: "🚫 @{user} foi removido.",
  adicionado: "✅ @{user} foi adicionado.",
  promovido: "⬆️ @{user} agora é administrador.",
  rebaixado: "⬇️ @{user} não é mais administrador.",
  grupoAberto: "🔓 Grupo aberto.",
  grupoFechado: "🔒 Grupo fechado.",
  antilink: "🚫 @{user}, link não é permitido aqui.",
  palavrao: "🚫 @{user}, essa palavra é proibida aqui.",
  adv: "⚠️ @{user} advertência {n}/{max}.",
  advBan: "🚫 @{user} chegou em {max} advertências e foi removido.",
  advZerada: "✅ Advertências de @{user} zeradas.",
  bemvindo: "🌸 Bem-vindo(a), @{user}!\n📍 {grupo}",
  saiu: "👋 @{user} saiu do grupo.",
  soAdmModo: "🔒 No momento só administradores usam meus comandos aqui.",
  ping: "🏓 Pong! {ms}ms",
  jogosOff: "🎮 Jogos desligados. Use {p}modojogos 1",
  parceriaLiberada: "🤝 Parceria liberada ({usados}/{limite})",
  parceriaAdd: "🤝 @{user} virou parceiro ({limite}/dia)",
  parceriaRm: "✅ @{user} não é mais parceiro.",
  naoParceiro: "Esse membro não é parceiro.",
  listaNegraAdd: "🛡️ @{user} entrou na lista negra.",
  listaNegraRm: "✅ @{user} saiu da lista negra.",
  listaNegraJa: "Esse número já está na lista negra.",
  listaNegraNao: "Esse número não está na lista negra.",
  grupoSalvo: "Grupo salvo com sucesso! 😺",
  semAluguel: "⏳ Grupo sem aluguel. Veja {p}planos",
  aluguelAcabando: "⏰ O aluguel vence amanhã. Renove: {p}planos",
  aluguelAcabou: "⏳ O aluguel acabou. Renove: {p}planos",
  pixGerado: "💎 {dias} dias · {valor}\nPague pelo QR ou copia e cola. Vale {min} min.",
  pixAprovado: "✅ Pix aprovado! +{dias} dias. Vence em {ate}",
  pixExpirou: "⌛ O Pix expirou.",
  listaNegraRemovido: "🛡️ @{user} está na lista negra. Removido.",
};

const custom = () => ler("textos", {});

export function t(chave, vars = {}) {
  let s = custom()[chave] ?? PADRAO[chave] ?? chave;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function definirTexto(chave, texto) {
  custom()[chave] = texto;
  salvar("textos");
}

export function resetarTexto(chave) {
  delete custom()[chave];
  salvar("textos");
}
