import { CANAL } from "../lib/selo.js";
import { cfg, soNumero } from "../lib/config.js";
import { t } from "../lib/textos.js";

const inicio = Date.now();
const tempo = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export default [
  {
    nomes: ["ping"], categoria: "geral", livre: true,
    run: async (c) => {
      const ms = Date.now() - Number(c.msg.messageTimestamp) * 1000;
      return c.reply(t("ping", { ms: Math.max(1, ms) }));
    },
  },
  {
    nomes: ["dono", "criador"], categoria: "geral", livre: true,
    run: async (c) => {
      const n = soNumero((cfg().dono || [])[0]);
      return c.reply(`👑 ${cfg().nomeDono || "Dono"}\nwa.me/${n}`);
    },
  },
  {
    nomes: ["info", "bot"], categoria: "geral", livre: true,
    run: async (c) => {
      const k = cfg();
      return c.reply(`🌸 *${k.nomeBot}* · version free\n👑 ${k.nomeDono}\n⏱️ ${tempo(Date.now() - inicio)}\n🔣 Prefixo: ${k.prefixo}\n📢 ${CANAL.link}`);
    },
  },
  {
    nomes: ["canal", "avisos"], categoria: "geral", livre: true,
    run: async (c) => c.reply(`📢 ${CANAL.link}`),
  },
  {
    nomes: ["eu"], categoria: "geral",
    run: async (c) => {
      const adv = c.isGroup ? c.g.advs[soNumero(c.autor)] || 0 : 0;
      return c.reply(`👤 @${soNumero(c.autor)}\n${c.isDono ? "👑 Dono" : c.isAdmin ? "🛡️ Administrador" : "🙂 Membro"}${c.isGroup ? `\n⚠️ Advertências: ${adv}/${cfg().maxAdv || 3}` : ""}`, [c.autor]);
    },
  },
];
