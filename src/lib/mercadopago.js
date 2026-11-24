import crypto from "node:crypto";
import { cfg } from "./config.js";

const API = "https://api.mercadopago.com";

export const mpLigado = () => Boolean(cfg().mercadoPagoToken);

async function chamar(caminho, opcoes = {}) {
  const token = cfg().mercadoPagoToken;
  if (!token) throw new Error("Mercado Pago não configurado");
  const r = await fetch(`${API}${caminho}`, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opcoes.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo?.message || `HTTP ${r.status}`);
  return corpo;
}

export async function testarToken() {
  const eu = await chamar("/users/me");
  return eu?.nickname || eu?.email || String(eu?.id || "ok");
}

export async function criarPix({ valor, descricao, minutos = 30 }) {
  const expira = new Date(Date.now() + minutos * 60_000).toISOString().replace("Z", "-00:00");
  const p = await chamar("/v1/payments", {
    method: "POST",
    headers: { "X-Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      transaction_amount: Number(Number(valor).toFixed(2)),
      description: descricao,
      payment_method_id: "pix",
      payer: { email: cfg().mercadoPagoEmail || "pagador@email.com" },
      date_of_expiration: expira,
    }),
  });
  const dados = p?.point_of_interaction?.transaction_data || {};
  return { id: String(p.id), copiaECola: dados.qr_code || "", qrBase64: dados.qr_code_base64 || "", link: dados.ticket_url || "" };
}

export async function statusPagamento(id) {
  const p = await chamar(`/v1/payments/${id}`);
  return p?.status || "desconhecido";
}

const validadeMP = (ms) => new Date(ms).toISOString().replace("Z", "-00:00");

export async function criarLinkCartao({ valor, descricao, referencia, minutos = 60 }) {
  const preco = Number(Number(valor).toFixed(2));
  const p = await chamar("/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      items: [{ title: String(descricao).slice(0, 120), quantity: 1, unit_price: preco, currency_id: "BRL" }],
      external_reference: referencia,
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 12 },
      expires: true,
      expiration_date_from: validadeMP(Date.now() - 60_000),
      expiration_date_to: validadeMP(Date.now() + minutos * 60_000),
    }),
  });
  const token = String(cfg().mercadoPagoToken || "");
  const link = token.startsWith("TEST-") ? p.sandbox_init_point || p.init_point : p.init_point;
  if (!link) throw new Error("o Mercado Pago não devolveu o link");
  return { id: String(p.id), link };
}

export async function pagoPorReferencia(referencia) {
  const b = await chamar(`/v1/payments/search?external_reference=${encodeURIComponent(referencia)}&sort=date_created&criteria=desc`);
  return (b?.results || []).find((x) => x.status === "approved") || null;
}
