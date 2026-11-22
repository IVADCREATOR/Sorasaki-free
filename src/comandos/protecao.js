import { t } from "../lib/textos.js";
import { soNumero } from "../lib/config.js";

const ADM = { grupo: true, admin: true, categoria: "admin" };

function alvoComIds(c) {
  const quem = c.alvo();
  if (!quem) return null;
  return { quem, ids: c.idsDe(quem) };
}

export default [
  {
    nomes: ["modoparceria"], ...ADM, desc: "1/0",
    run: async (c) => {
      const v = c.args[0];
      if (v !== "1" && v !== "0") return c.reply(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
      c.g.parceria = v === "1";
      c.salvarGrupo();
      return c.reply(t(v === "1" ? "ativado" : "desativado"));
    },
  },
  {
    nomes: ["addparceria", "addparceiro"], ...ADM, desc: "@membro links",
    run: async (c) => {
      const a = alvoComIds(c);
      if (!a) return c.reply(`${c.prefixo}addparceria @membro 2`);
      const limite = Math.min(50, Math.max(1, Number(c.args.find((x) => /^\d{1,2}$/.test(x))) || 1));
      const k = soNumero(a.quem);
      c.g.parceiros[k] = { jid: a.quem, ids: a.ids, limite, usados: 0, dia: "" };
      c.salvarGrupo();
      return c.reply(t("parceriaAdd", { user: k, limite }), [a.quem]);
    },
  },
  {
    nomes: ["delparceria", "rmparceria", "delparceiro"], ...ADM, desc: "@membro",
    run: async (c) => {
      const a = alvoComIds(c);
      if (!a) return c.reply(t("marqueAlguem"));
      const k = Object.keys(c.g.parceiros).find((x) => (c.g.parceiros[x].ids || [x]).some((i) => a.ids.includes(i)));
      if (!k) return c.reply(t("naoParceiro"));
      delete c.g.parceiros[k];
      c.salvarGrupo();
      return c.reply(t("parceriaRm", { user: soNumero(a.quem) }), [a.quem]);
    },
  },
  {
    nomes: ["parcerias", "parceiros"], ...ADM,
    run: async (c) => {
      const lista = Object.entries(c.g.parceiros);
      if (!lista.length) return c.reply("🤝 Nenhum parceiro.");
      const linhas = lista.map(([k, v]) => `┃ @${k} · ${v.dia === new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) ? v.usados : 0}/${v.limite} hoje`);
      const estado = c.g.parceria ? "🟢 ligado" : "🔴 desligado";
      return c.reply(`╭━━━ 🤝 PARCERIAS ━━━\n┃ Modo: ${estado}\n${linhas.join("\n")}\n╰━━━━━━━━━━━━━━━`, lista.map(([k, v]) => v.jid || `${k}@s.whatsapp.net`));
    },
  },

  {
    nomes: ["listanegra", "addlistanegra"], ...ADM, desc: "@membro ou número",
    run: async (c) => {
      const a = alvoComIds(c);
      if (!a) return c.reply(`${c.prefixo}listanegra @membro`);
      if (a.ids.some((i) => c.g.listanegra.includes(i))) return c.reply(t("listaNegraJa"));
      c.g.listanegra.push(...a.ids);
      c.salvarGrupo();
      await c.reply(t("listaNegraAdd", { user: soNumero(a.quem) }), [a.quem]);
      const dentro = (c.meta?.participants || []).some((p) => [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).map(soNumero).some((i) => a.ids.includes(i)));
      if (dentro && c.isBotAdmin) {
        await c.sock.groupParticipantsUpdate(c.jid, [a.quem], "remove").catch(() => {});
        await c.reply(t("listaNegraRemovido", { user: soNumero(a.quem) }), [a.quem]);
      }
    },
  },
  {
    nomes: ["rmlistanegra", "dellistanegra"], ...ADM, desc: "@membro ou número",
    run: async (c) => {
      const a = alvoComIds(c);
      if (!a) return c.reply(t("marqueAlguem"));
      if (!a.ids.some((i) => c.g.listanegra.includes(i))) return c.reply(t("listaNegraNao"));
      c.g.listanegra = c.g.listanegra.filter((i) => !a.ids.includes(i));
      c.salvarGrupo();
      return c.reply(t("listaNegraRm", { user: soNumero(a.quem) }), [a.quem]);
    },
  },
  {
    nomes: ["verlistanegra", "listanegras"], ...ADM,
    run: async (c) => {
      const lista = c.g.listanegra.filter((n) => n.length >= 10 && n.length <= 13);
      if (!c.g.listanegra.length) return c.reply("🛡️ Lista vazia.");
      const mostrar = lista.length ? lista : c.g.listanegra;
      return c.reply(`╭━━━ 🛡️ LISTA NEGRA ━━━\n${mostrar.map((n) => `┃ ${n}`).join("\n")}\n╰━━━━━━━━━━━━━━━`);
    },
  },
];
