import { cfg, definir, soNumero } from "../lib/config.js";
import { t } from "../lib/textos.js";
import {
  modoAluguel, planos, ehPermanente, salvarPermanente, reais, diasRestantes, vencimento, adicionarDias, removerAluguel,
  listaAlugueis, definirPlano, pendentes, guardarPendente, tirarPendente, dataBr,
} from "../lib/aluguel.js";
import { mpLigado, criarPix, statusPagamento, testarToken } from "../lib/mercadopago.js";

const LIVRE = { categoria: "aluguel", livre: true, semAluguel: true };
const DONO = { categoria: "dono", dono: true, semAluguel: true };
const MINUTOS_PIX = 30;

let vigiaPix = null;
export function iniciarPagamentos(sock) {
  clearInterval(vigiaPix);
  vigiaPix = setInterval(async () => {
    for (const [id, p] of Object.entries(pendentes())) {
      if (Date.now() - p.criado > (MINUTOS_PIX + 5) * 60_000) {
        tirarPendente(id);
        await sock.sendMessage(p.jid, { text: t("pixExpirou") }).catch(() => {});
        continue;
      }
      const status = await statusPagamento(id).catch(() => null);
      if (status === "approved") {
        tirarPendente(id);
        const ate = adicionarDias(p.jid, p.dias, p.nome);
        await sock.sendMessage(p.jid, { text: t("pixAprovado", { dias: p.dias, ate: dataBr(ate) }) }).catch(() => {});
        for (const n of (cfg().dono || []).map(soNumero).filter(Boolean)) {
          await sock.sendMessage(`${n}@s.whatsapp.net`, { text: `💰 Pix aprovado: ${reais(p.valor)} · ${p.dias} dias · *${p.nome || p.jid}*` }).catch(() => {});
        }
      } else if (["cancelled", "rejected", "refunded", "charged_back"].includes(status)) {
        tirarPendente(id);
      }
    }
  }, 20_000);
}

const listaPlanos = (p) => planos().map((x) => `┃ ${x.dias} dias · ${reais(x.valor)}  →  ${p}alugar ${x.dias}`).join("\n");

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
      if (!mpLigado()) return c.reply(`Alugue com o dono: ${c.prefixo}dono`);
      const nome = c.meta?.subject || "";
      const pix = await criarPix({ valor: plano.valor, descricao: `${cfg().nomeBot} · ${plano.dias} dias · ${nome}`.slice(0, 200), minutos: MINUTOS_PIX });
      guardarPendente(pix.id, { jid: c.jid, dias: plano.dias, valor: plano.valor, nome, criado: Date.now() });
      const legenda = t("pixGerado", { dias: plano.dias, valor: reais(plano.valor), min: MINUTOS_PIX });
      if (pix.qrBase64) await c.sock.sendMessage(c.jid, { image: Buffer.from(pix.qrBase64, "base64"), caption: legenda }, { quoted: c.msg });
      else await c.reply(legenda);
      return c.sock.sendMessage(c.jid, { text: pix.copiaECola || pix.link });
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
