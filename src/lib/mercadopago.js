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
