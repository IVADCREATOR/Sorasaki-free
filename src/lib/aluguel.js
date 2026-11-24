import { ler, salvar } from "./banco.js";
import { cfg, soNumero } from "./config.js";
import { saldoDe, debitar } from "./saldo.js";

const DIA = 86_400_000;
const dados = () => ler("aluguel", { grupos: {}, planos: [{ dias: 7, valor: 5 }, { dias: 30, valor: 15 }], pendentes: {} });
const salvarAluguel = () => salvar("aluguel");

export const modoAluguel = () => Boolean(cfg().aluguel);
export const planos = () => [...dados().planos].sort((a, b) => a.dias - b.dias);
export const reais = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function vencimento(jid) {
  return dados().grupos[jid]?.ate || 0;
}

export function grupoAtivo(jid) {
  if (!modoAluguel()) return true;
  return ehPermanente(jid) || vencimento(jid) > Date.now();
}

export const ehPermanente = (jid) => Boolean(dados().grupos[jid]?.permanente);

export function salvarPermanente(jid, nome = "") {
  const g = (dados().grupos[jid] ||= { ate: 0 });
  g.permanente = true;
  if (nome) g.nome = nome;
  salvarAluguel();
}

export function diasRestantes(jid) {
  const falta = vencimento(jid) - Date.now();
  return falta > 0 ? Math.ceil(falta / DIA) : 0;
}

export function adicionarDias(jid, dias, nome = "") {
  const d = dados();
  const g = (d.grupos[jid] ||= { ate: 0 });
  g.ate = Math.max(g.ate, Date.now()) + dias * DIA;
  if (nome) g.nome = nome;
  g.avisou1 = false;
  g.avisouFim = false;
  salvarAluguel();
  return g.ate;
}

export function definirPagador(jid, pagador, dias) {
  const g = dados().grupos[jid];
  if (!g) return;
  if (pagador) g.pagador = soNumero(pagador);
  if (dias) g.dias = dias;
  salvarAluguel();
}

export function renovacaoAuto(jid, valor) {
  const g = dados().grupos[jid];
  if (!g) return false;
  if (typeof valor === "boolean") { g.renovarAuto = valor; salvarAluguel(); }
  return g.renovarAuto !== false;
}

export function removerAluguel(jid) {
  const d = dados();
  const tinha = Boolean(d.grupos[jid]);
  delete d.grupos[jid];
  salvarAluguel();
  return tinha;
}

export const listaAlugueis = () => Object.entries(dados().grupos).sort((a, b) => a[1].ate - b[1].ate);

export function definirPlano(dias, valor) {
  const d = dados();
  d.planos = d.planos.filter((p) => p.dias !== dias);
  if (valor > 0) d.planos.push({ dias, valor });
  salvarAluguel();
}

export const pendentes = () => dados().pendentes;
export function guardarPendente(id, info) { dados().pendentes[id] = info; salvarAluguel(); }
export function tirarPendente(id) { delete dados().pendentes[id]; salvarAluguel(); }

export const dataBr = (ms) => new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function iniciarVigia(sock, texto) {
  const verificar = async () => {
    if (!modoAluguel()) return;
    const d = dados();
    const agora = Date.now();
    for (const [jid, g] of Object.entries(d.grupos)) {
      if (g.permanente) continue;
      const falta = g.ate - agora;
      if (falta > 0 && falta <= DIA && !g.avisou1) {
        g.avisou1 = true;
        salvarAluguel();
        await sock.sendMessage(jid, { text: texto("aluguelAcabando", { p: cfg().prefixo }) }).catch(() => {});
      }
      if (falta <= 0 && !g.avisouFim && g.renovarAuto !== false && g.pagador) {
        const plano = planos().find((x) => x.dias === g.dias) || planos()[0];
        if (plano && saldoDe(g.pagador) >= plano.valor && debitar([g.pagador], plano.valor)) {
          const ate = adicionarDias(jid, plano.dias, g.nome);
          await sock.sendMessage(jid, { text: `🔄 Aluguel renovado com saldo: +${plano.dias} dias · vence ${dataBr(ate)}` }).catch(() => {});
          await sock.sendMessage(`${g.pagador}@s.whatsapp.net`, { text: `🔄 Renovei o aluguel de *${g.nome || "seu grupo"}* com seu saldo (${reais(plano.valor)}).\n💵 Saldo: ${reais(saldoDe(g.pagador))}` }).catch(() => {});
          continue;
        }
      }
      if (falta <= 0 && !g.avisouFim) {
        g.avisouFim = true;
        salvarAluguel();
        await sock.sendMessage(jid, { text: texto("aluguelAcabou", { p: cfg().prefixo }) }).catch(() => {});
        for (const n of (cfg().dono || []).map(soNumero).filter(Boolean)) {
          await sock.sendMessage(`${n}@s.whatsapp.net`, { text: `⏰ O aluguel do grupo *${g.nome || jid}* venceu.` }).catch(() => {});
        }
      }
    }
  };
  verificar();
  return setInterval(verificar, 10 * 60_000);
}
