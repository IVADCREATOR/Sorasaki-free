import { t } from "../lib/textos.js";
import fs from "node:fs";
import path from "node:path";
import { downloadMediaMessage } from "baileys";
import { soNumero } from "../lib/config.js";
import { enviarBemVindo, fotoPropriaBv } from "../eventos.js";

const onOff = (chave) => async (c) => {
  const v = c.args[0];
  if (v !== "1" && v !== "0") return c.reply(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
  c.g[chave] = v === "1";
  c.salvarGrupo();
  return c.reply(t(v === "1" ? "ativado" : "desativado"));
};

const mudarMembro = (acao, chaveTexto) => async (c) => {
  const quem = c.alvo();
  if (!quem) return c.reply(t("marqueAlguem"));
  await c.sock.groupParticipantsUpdate(c.jid, [quem], acao);
  return c.reply(t(chaveTexto, { user: soNumero(quem) }), [quem]);
};

const ADM = { grupo: true, admin: true, categoria: "admin" };
const ADM_BOT = { ...ADM, botAdmin: true };

export default [
  { nomes: ["ban", "kick", "remover"], ...ADM_BOT, desc: "@membro", run: mudarMembro("remove", "removido") },
  { nomes: ["add", "adicionar"], ...ADM_BOT, desc: "número", run: mudarMembro("add", "adicionado") },
  { nomes: ["promover"], ...ADM_BOT, desc: "@membro", run: mudarMembro("promote", "promovido") },
  { nomes: ["rebaixar"], ...ADM_BOT, desc: "@membro", run: mudarMembro("demote", "rebaixado") },

  { nomes: ["abrir"], ...ADM_BOT, run: async (c) => { await c.sock.groupSettingUpdate(c.jid, "not_announcement"); return c.reply(t("grupoAberto")); } },
  { nomes: ["fechar"], ...ADM_BOT, run: async (c) => { await c.sock.groupSettingUpdate(c.jid, "announcement"); return c.reply(t("grupoFechado")); } },

  { nomes: ["antilink"], ...ADM, desc: "1/0", run: onOff("antilink") },
  { nomes: ["antipalavrao"], ...ADM, desc: "1/0", run: onOff("antipalavrao") },
  { nomes: ["bemvindo"], ...ADM, desc: "1/0", run: onOff("bemvindo") },
  { nomes: ["soadm"], ...ADM, desc: "1/0", run: onOff("soadm") },

  {
    nomes: ["addpalavra"], ...ADM, desc: "palavra",
    run: async (c) => {
      const p = c.texto.toLowerCase().trim();
      if (!p) return c.reply(`${c.prefixo}addpalavra palavra`);
      if (!c.g.palavras.includes(p)) c.g.palavras.push(p);
      c.salvarGrupo();
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["delpalavra"], ...ADM, desc: "palavra",
    run: async (c) => {
      const p = c.texto.toLowerCase().trim();
      c.g.palavras = c.g.palavras.filter((x) => x !== p);
      c.salvarGrupo();
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["palavras"], ...ADM,
    run: async (c) => c.reply(c.g.palavras.length ? `🚫 ${c.g.palavras.join(", ")}` : "—"),
  },

  {
    nomes: ["legendabv"], ...ADM, desc: "texto",
    run: async (c) => {
      c.g.legendabv = c.texto;
      c.salvarGrupo();
      return c.reply(c.texto ? t("feito") : `${c.prefixo}legendabv Bem-vindo @{user} ao {grupo}`);
    },
  },
  {
    nomes: ["legendasaiu"], ...ADM, desc: "texto",
    run: async (c) => {
      c.g.legendasaiu = c.texto;
      c.salvarGrupo();
      return c.reply(c.texto ? t("feito") : `${c.prefixo}legendasaiu Tchau @{user}`);
    },
  },
  {
    nomes: ["fotobv"], ...ADM, desc: "perfil/grupo/0 ou responda foto",
    run: async (c) => {
      const q = c.citadoMsg;
      const direto = c.msg.message?.imageMessage;
      if (direto || q?.imageMessage) {
        const buf = await downloadMediaMessage(direto ? c.msg : { key: c.msg.key, message: q }, "buffer", {});
        fs.mkdirSync(path.dirname(fotoPropriaBv(c.jid)), { recursive: true });
        fs.writeFileSync(fotoPropriaBv(c.jid), buf);
        c.g.fotobv = "propria";
        c.salvarGrupo();
        return c.reply(t("feito"));
      }
      const modos = { perfil: "perfil", grupo: "grupo", "0": "nenhuma", nenhuma: "nenhuma" };
      const modo = modos[(c.args[0] || "").toLowerCase()];
      if (!modo) return c.reply(`${c.prefixo}fotobv perfil / grupo / 0`);
      c.g.fotobv = modo;
      c.salvarGrupo();
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["testebv"], ...ADM,
    run: async (c) => enviarBemVindo(c.sock, c.jid, c.autor, c.meta, c.g, false),
  },
  {
    nomes: ["testesaiu"], ...ADM,
    run: async (c) => enviarBemVindo(c.sock, c.jid, c.autor, c.meta, c.g, true),
  },

  {
    nomes: ["adv", "advertir"], ...ADM, desc: "@membro",
    run: async (c) => {
      const quem = c.alvo();
      if (!quem) return c.reply(t("marqueAlguem"));
      return c.advertir(quem);
    },
  },
  {
    nomes: ["rmadv", "zeraradv"], ...ADM, desc: "@membro",
    run: async (c) => {
      const quem = c.alvo();
      if (!quem) return c.reply(t("marqueAlguem"));
      delete c.g.advs[soNumero(quem)];
      c.salvarGrupo();
      return c.reply(t("advZerada", { user: soNumero(quem) }), [quem]);
    },
  },
  {
    nomes: ["advs", "listaadv"], ...ADM,
    run: async (c) => {
      const l = Object.entries(c.g.advs);
      if (!l.length) return c.reply("—");
      return c.reply(l.map(([n, q]) => `⚠️ @${n} · ${q}`).join("\n"), l.map(([n]) => `${n}@s.whatsapp.net`));
    },
  },

  {
    nomes: ["marcar", "todos"], ...ADM,
    run: async (c) => {
      const ids = (c.meta?.participants || []).map((p) => p.id);
      return c.reply(`📢 ${c.texto || ""}\n\n${ids.map((i) => `@${soNumero(i)}`).join(" ")}`, ids);
    },
  },
  {
    nomes: ["hidetag", "avisar"], ...ADM, desc: "texto",
    run: async (c) => {
      const ids = (c.meta?.participants || []).map((p) => p.id);
      return c.sock.sendMessage(c.jid, { text: c.texto || "📢", mentions: ids });
    },
  },

  {
    nomes: ["apagar", "del"], ...ADM_BOT,
    run: async (c) => {
      const ctx = c.msg.message?.extendedTextMessage?.contextInfo;
      if (!ctx?.stanzaId) return c.reply(t("marqueAlguem"));
      return c.sock.sendMessage(c.jid, { delete: { remoteJid: c.jid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false } });
    },
  },

  {
    nomes: ["linkgp", "link"], ...ADM_BOT,
    run: async (c) => c.reply(`https://chat.whatsapp.com/${await c.sock.groupInviteCode(c.jid)}`),
  },
  {
    nomes: ["resetlink", "redefinirlink"], ...ADM_BOT,
    run: async (c) => { await c.sock.groupRevokeInvite(c.jid); return c.reply(t("feito")); },
  },
  {
    nomes: ["nomegp"], ...ADM_BOT, desc: "nome",
    run: async (c) => { if (!c.texto) return c.reply(`${c.prefixo}nomegp nome`); await c.sock.groupUpdateSubject(c.jid, c.texto); return c.reply(t("feito")); },
  },
  {
    nomes: ["descgp"], ...ADM_BOT, desc: "texto",
    run: async (c) => { await c.sock.groupUpdateDescription(c.jid, c.texto); return c.reply(t("feito")); },
  },
];
