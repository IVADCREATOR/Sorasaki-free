import crypto from "node:crypto";
import { cfg, definir, soNumero } from "../lib/config.js";
import { saldoDe, creditar, debitar } from "../lib/saldo.js";
import { t } from "../lib/textos.js";
import {
  modoAluguel, planos, ehPermanente, salvarPermanente, reais, diasRestantes, vencimento, adicionarDias, removerAluguel,
  listaAlugueis, definirPlano, pendentes, guardarPendente, tirarPendente, dataBr, definirPagador, renovacaoAuto,
} from "../lib/aluguel.js";
import { mpLigado, criarPix, statusPagamento, testarToken, criarLinkCartao, pagoPorReferencia } from "../lib/mercadopago.js";

const LIVRE = { categoria: "aluguel", livre: true, semAluguel: true };
const DONO = { categoria: "dono", dono: true, semAluguel: true };
const MINUTOS_PIX = 30;
const MINUTOS_CARTAO = 60;
const ehCartao = (args) => (args || []).some((a) => /^(cart[aã]o|credito|cr[eé]dito|debito|d[eé]bito)$/i.test(String(a)));
const ehSaldo = (args) => (args || []).some((a) => /^saldo$/i.test(String(a)));
const quem = (c) => [c.autor, c.autorAlt].filter(Boolean);
const numeroDe = (c) => soNumero(c.autorAlt && c.autorAlt.endsWith("@s.whatsapp.net") ? c.autorAlt : c.autor);

async function avisarDonos(sock, texto) {
  for (const n of (cfg().dono || []).map(soNumero).filter(Boolean)) {
    await sock.sendMessage(`${n}@s.whatsapp.net`, { text: texto }).catch(() => {});
  }
}

async function entregar(sock, id, p) {
  tirarPendente(id);
  if (p.tipo === "saldo") {
    creditar(p.pagador, p.valor);
    await sock.sendMessage(p.jid, { text: `✅ Saldo adicionado: +${reais(p.valor)}\n💵 Saldo atual: ${reais(saldoDe(p.pagador))}` }).catch(() => {});
    return avisarDonos(sock, `💰 Saldo: ${reais(p.valor)} · ${p.pagador}`);
  }
  const ate = adicionarDias(p.jid, p.dias, p.nome);
  definirPagador(p.jid, p.pagador, p.dias);
  await sock.sendMessage(p.jid, { text: p.metodo === "cartao" ? `✅ Pagamento aprovado! +${p.dias} dias. Vence em ${dataBr(ate)}` : t("pixAprovado", { dias: p.dias, ate: dataBr(ate) }) }).catch(() => {});
  return avisarDonos(sock, `💰 ${p.metodo === "cartao" ? "Cartão" : "Pix"} aprovado: ${reais(p.valor)} · ${p.dias} dias · *${p.nome || p.jid}*`);
}

async function gerarCobranca(c, { valor, descricao, dados, legenda }) {
  if (ehCartao(c.args)) {
    const ref = crypto.randomUUID();
    const cartao = await criarLinkCartao({ valor, descricao, referencia: ref, minutos: MINUTOS_CARTAO });
    guardarPendente(ref, { ...dados, valor, metodo: "cartao", criado: Date.now() });
    await c.reply(`💳 ${legenda}\nPague no link (crédito ou débito). Vale ${MINUTOS_CARTAO} min.\nConfirmo sozinha ✅`);
    return c.sock.sendMessage(c.jid, { text: cartao.link });
  }
  const pix = await criarPix({ valor, descricao, minutos: MINUTOS_PIX });
  guardarPendente(pix.id, { ...dados, valor, metodo: "pix", criado: Date.now() });
  const texto = `💠 ${legenda}\nPague pelo QR ou copia e cola. Vale ${MINUTOS_PIX} min.`;
  if (pix.qrBase64) await c.sock.sendMessage(c.jid, { image: Buffer.from(pix.qrBase64, "base64"), caption: texto }, { quoted: c.msg });
  else await c.reply(texto);
  return c.sock.sendMessage(c.jid, { text: pix.copiaECola || pix.link });
}

let vigiaPix = null;
export function iniciarPagamentos(sock) {
  clearInterval(vigiaPix);
  vigiaPix = setInterval(async () => {
    for (const [id, p] of Object.entries(pendentes())) {
      const limite = (p.metodo === "cartao" ? MINUTOS_CARTAO : MINUTOS_PIX) + 5;
      if (Date.now() - p.criado > limite * 60_000) {
        tirarPendente(id);
        await sock.sendMessage(p.jid, { text: p.metodo === "cartao" ? "⌛ O link do cartão expirou." : t("pixExpirou") }).catch(() => {});
        continue;
      }
      if (p.metodo === "cartao") {
        const pago = await pagoPorReferencia(id).catch(() => null);
        if (pago) await entregar(sock, id, p);
        continue;
      }
      const status = await statusPagamento(id).catch(() => null);
      if (status === "approved") await entregar(sock, id, p);
      else if (["cancelled", "rejected", "refunded", "charged_back"].includes(status)) tirarPendente(id);
    }
  }, 20_000);
}

const listaPlanos = (p) => planos().map((x) => `┃ ${x.dias} dias · ${reais(x.valor)}\n┃   Pix: ${p}alugar ${x.dias}\n┃   Cartão: ${p}alugar ${x.dias} cartao\n┃   Saldo: ${p}alugar ${x.dias} saldo`).join("\n┃\n");

export default [
  {
    nomes: ["aluguel", "meualuguel", "vencimento"], ...LIVRE, grupo: true,
    run: async (c) => {
      if (!modoAluguel() || ehPermanente(c.jid)) return c.reply("♾️ Grupo liberado.");
      const dias = diasRestantes(c.jid);
      if (!dias) return c.reply(t("semAluguel", { p: c.prefixo }));
      return c.reply(`📅 ${dias} dia(s) · vence ${dataBr(vencimento(c.jid))}`);
    },
  },
  {
    nomes: ["planos", "precos"], ...LIVRE,
    run: async (c) => {
      if (!planos().length) return c.reply(`Sem planos. Fale com o dono: ${c.prefixo}dono`);
      const como = mpLigado() ? "" : `\nAlugue com o dono: ${c.prefixo}dono`;
      return c.reply(`╭━━━ 💎 PLANOS ━━━\n${listaPlanos(c.prefixo)}\n╰━━━━━━━━━━━━━━━${como}`);
    },
  },
  {
    nomes: ["alugar", "renovar", "pix"], ...LIVRE, grupo: true, desc: "dias",
    run: async (c) => {
      const plano = planos().find((x) => x.dias === Number(c.args[0]));
      if (!plano) return c.reply(`╭━━━ 💎 PLANOS ━━━\n${listaPlanos(c.prefixo) || "┃ nenhum"}\n╰━━━━━━━━━━━━━━━`);
      const nome = c.meta?.subject || "";
      if (ehSaldo(c.args)) {
        if (!debitar(quem(c), plano.valor)) return c.reply(`💵 Saldo insuficiente: ${reais(saldoDe(quem(c)))}\nAdicione: ${c.prefixo}adicionarsaldo ${Math.ceil(plano.valor)}`);
        const ate = adicionarDias(c.jid, plano.dias, nome);
        definirPagador(c.jid, numeroDe(c), plano.dias);
        return c.reply(`✅ Pago com saldo! +${plano.dias} dias · vence ${dataBr(ate)}\n💵 Saldo: ${reais(saldoDe(quem(c)))}`);
      }
      if (!mpLigado()) return c.reply(`Alugue com o dono: ${c.prefixo}dono`);
      try {
        return await gerarCobranca(c, {
          valor: plano.valor,
          descricao: `${cfg().nomeBot} · ${plano.dias} dias · ${nome}`.slice(0, 200),
          dados: { jid: c.jid, dias: plano.dias, nome, pagador: numeroDe(c) },
          legenda: `${plano.dias} dias · ${reais(plano.valor)}`,
        });
      } catch {
        return c.reply("⚠️ Não consegui gerar o pagamento agora.");
      }
    },
  },
  {
    nomes: ["adicionarsaldo", "recarga", "saldopix"], ...LIVRE, desc: "valor",
    run: async (c) => {
      const v = Math.round(Number(String(c.args.find((a) => /^\d+([.,]\d{1,2})?$/.test(a)) || "").replace(",", ".")) * 100) / 100;
      if (!(v >= 1 && v <= 500)) return c.reply(`💵 Saldo: ${reais(saldoDe(quem(c)))}\n\nPix: ${c.prefixo}adicionarsaldo 10\nCartão: ${c.prefixo}adicionarsaldo 10 cartao\n\n_De R$ 1 a R$ 500. Sem reembolso._`);
      if (!mpLigado()) return c.reply("💳 Pagamento não configurado pelo dono.");
      try {
        return await gerarCobranca(c, {
          valor: v,
          descricao: `${cfg().nomeBot} · saldo ${reais(v)}`,
          dados: { tipo: "saldo", jid: c.jid, pagador: numeroDe(c) },
          legenda: `Saldo · ${reais(v)}`,
        });
      } catch {
        return c.reply("⚠️ Não consegui gerar o pagamento agora.");
      }
    },
  },
  {
    nomes: ["saldoreal", "meusaldoreal", "meudinheiro"], ...LIVRE,
    run: async (c) => c.reply(`💵 Seu saldo: ${reais(saldoDe(quem(c)))}\nAdicionar: ${c.prefixo}adicionarsaldo 10`),
  },
  {
    nomes: ["renovarauto", "autorenovar"], ...LIVRE, grupo: true, desc: "on/off",
    run: async (c) => {
      const v = String(c.args[0] || "").toLowerCase();
      if (!["on", "off", "1", "0"].includes(v)) return c.reply(`🔄 Renovação automática: ${renovacaoAuto(c.jid) ? "ligada" : "desligada"}\nCom saldo, renovo sozinha no vencimento.\n${c.prefixo}renovarauto on · off`);
      if (!c.isAdmin && !c.isDono) return c.reply(t("soAdmin"));
      renovacaoAuto(c.jid, v === "on" || v === "1");
      return c.reply(t("feito"));
    },
  },

  {
    nomes: ["darsaldo", "setsaldo"], ...DONO, desc: "número valor",
    run: async (c) => {
      const num = soNumero(c.args[0]);
      const v = Number(String(c.args[1] || "").replace(",", "."));
      if (!num || !Number.isFinite(v) || !v) return c.reply(`${c.prefixo}darsaldo 5511999999999 10`);
      creditar(num, v);
      return c.reply(`✅ Saldo de ${num}: ${reais(saldoDe(num))}`);
    },
  },
  {
    nomes: ["modoaluguel"], ...DONO, desc: "1/0",
    run: async (c) => {
      const v = c.args[0];
      if (v !== "1" && v !== "0") return c.reply(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
      definir("aluguel", v === "1");
      return c.reply(t(v === "1" ? "ativado" : "desativado"));
    },
  },
  {
    nomes: ["addaluguel", "liberargp"], ...DONO, grupo: true, desc: "dias",
    run: async (c) => {
      const dias = Math.floor(Number(c.args[0]));
      if (!(dias > 0 && dias <= 3650)) return c.reply(`${c.prefixo}addaluguel 30`);
      const ate = adicionarDias(c.jid, dias, c.meta?.subject || "");
      return c.reply(`✅ +${dias} dias · vence ${dataBr(ate)}`);
    },
  },
  {
    nomes: ["rmaluguel", "tiraraluguel"], ...DONO, grupo: true,
    run: async (c) => c.reply(removerAluguel(c.jid) ? t("feito") : "Grupo sem aluguel."),
  },
  {
    nomes: ["savegp", "salvargp"], ...DONO, grupo: true,
    run: async (c) => { salvarPermanente(c.jid, c.meta?.subject || ""); return c.reply(t("grupoSalvo")); },
  },
  {
    nomes: ["alugueis", "listaaluguel"], ...DONO,
    run: async (c) => {
      const l = listaAlugueis();
      if (!l.length) return c.reply("Nenhum grupo alugado.");
      const linhas = l.map(([, g]) => `┃ ${g.permanente ? "♾️" : g.ate > Date.now() ? "🟢" : "🔴"} ${g.nome || "grupo"} · ${g.permanente ? "permanente" : dataBr(g.ate)}`);
      return c.reply(`╭━━━ 📅 ALUGUÉIS ━━━\n┃ Modo: ${modoAluguel() ? "🟢 ligado" : "🔴 desligado"}\n${linhas.join("\n")}\n╰━━━━━━━━━━━━━━━`);
    },
  },
  {
    nomes: ["addplano"], ...DONO, desc: "dias valor",
    run: async (c) => {
      const dias = Math.floor(Number(c.args[0]));
      const valor = Number(String(c.args[1] || "").replace(",", "."));
      if (!(dias > 0) || !(valor > 0)) return c.reply(`${c.prefixo}addplano 30 15`);
      definirPlano(dias, valor);
      return c.reply(`✅ Plano de ${dias} dias por ${reais(valor)}.`);
    },
  },
  {
    nomes: ["rmplano"], ...DONO, desc: "dias",
    run: async (c) => {
      const dias = Math.floor(Number(c.args[0]));
      if (!(dias > 0)) return c.reply(`${c.prefixo}rmplano 30`);
      definirPlano(dias, 0);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["setmp", "mercadopago"], ...DONO, desc: "token",
    run: async (c) => {
      if (c.isGroup) {
        await c.sock.sendMessage(c.jid, { delete: c.msg.key }).catch(() => {});
        return c.reply("🔒 Mande no privado.");
      }
      const token = c.args[0];
      if (!token) return c.reply(`${c.prefixo}setmp APP_USR-...`);
      definir("mercadoPagoToken", token);
      try {
        const conta = await testarToken();
        return c.reply(`✅ Conectado: ${conta}`);
      } catch (e) {
        definir("mercadoPagoToken", "");
        return c.reply("❌ Token inválido.");
      }
    },
  },
  {
    nomes: ["setemailmp"], ...DONO, desc: "email",
    run: async (c) => {
      if (!/^\S+@\S+\.\S+$/.test(c.args[0] || "")) return c.reply(`${c.prefixo}setemailmp seuemail@gmail.com`);
      definir("mercadoPagoEmail", c.args[0]);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["rmmp"], ...DONO,
    run: async (c) => { definir("mercadoPagoToken", ""); return c.reply(t("feito")); },
  },
  {
    nomes: ["mpstatus"], ...DONO,
    run: async (c) => {
      if (!mpLigado()) return c.reply("🔴 Desligado.");
      try { return c.reply(`🟢 Conectado: ${await testarToken()}`); }
      catch { return c.reply("⚠️ Token inválido."); }
    },
  },
];
