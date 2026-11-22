import { ler, salvar } from "../lib/banco.js";
import { mpLigado, criarPix, statusPagamento } from "../lib/mercadopago.js";
import { reais } from "../lib/aluguel.js";
import { sockAtual } from "./conexao.js";

const produtos = new Map();
const pendentes = () => ler("pix-rpg", {});

export function registrarProduto(tipo, fns) { produtos.set(tipo, fns); }

export async function falar(jid, texto, extra = {}) {
  await sockAtual()?.sendMessage(jid, { text: texto, ...extra }).catch(() => {});
}

export async function cobrar(c, { tipo, valor, descricao, dados = {} }) {
  if (!mpLigado()) { await c.responder("💳 Pix não configurado pelo dono."); return null; }
  const pix = await criarPix({ valor, descricao: String(descricao).slice(0, 120), minutos: 30 }).catch(() => null);
  if (!pix) { await c.responder("⚠️ Não consegui gerar o Pix."); return null; }
  pendentes()[pix.id] = { tipo, dados, jid: c.jid, criado: Date.now() };
  salvar("pix-rpg");
  const legenda = `💳 ${descricao}\n💰 ${reais(valor)} · vale 30 min`;
  if (pix.qrBase64) await c.sock.sendMessage(c.jid, { image: Buffer.from(pix.qrBase64, "base64"), caption: legenda }, { quoted: c.msg });
  else await c.responder(legenda);
  await c.sock.sendMessage(c.jid, { text: pix.copiaECola || pix.link });
  return pix;
}

setInterval(async () => {
  const lista = pendentes();
  for (const [id, p] of Object.entries(lista)) {
    if (Date.now() - p.criado > 35 * 60_000) { delete lista[id]; salvar("pix-rpg"); continue; }
    const status = await statusPagamento(id).catch(() => null);
    if (status === "approved") {
      delete lista[id];
      salvar("pix-rpg");
      await produtos.get(p.tipo)?.aplicar({ id, dados: p.dados }).catch(() => {});
    } else if (["cancelled", "rejected", "refunded"].includes(status)) {
      delete lista[id];
      salvar("pix-rpg");
    }
  }
}, 20_000).unref?.();
