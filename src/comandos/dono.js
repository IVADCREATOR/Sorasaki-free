import fs from "node:fs";
import path from "node:path";
import { downloadMediaMessage } from "baileys";
import { cfg, definir, soNumero } from "../lib/config.js";
import { PASTA_DADOS } from "../lib/banco.js";
import { t, PADRAO, definirTexto, resetarTexto } from "../lib/textos.js";

const DONO = { dono: true, categoria: "dono" };

async function imagemCitada(c) {
  const q = c.citadoMsg;
  const direto = c.msg.message?.imageMessage;
  if (direto) return downloadMediaMessage(c.msg, "buffer", {});
  if (q?.imageMessage) return downloadMediaMessage({ key: c.msg.key, message: q }, "buffer", {});
  return null;
}

const mudarConfig = (chave, exemplo) => async (c) => {
  if (!c.texto) return c.reply(`${c.prefixo}${c.cmd} ${exemplo}`);
  definir(chave, c.texto);
  return c.reply(t("feito"));
};

export default [
  { nomes: ["setnome"], ...DONO, desc: "nome", run: mudarConfig("nomeBot", "Sorasaki") },
  { nomes: ["setprefixo"], ...DONO, desc: "símbolo", run: mudarConfig("prefixo", "!") },
  { nomes: ["setrodape"], ...DONO, desc: "texto", run: mudarConfig("rodape", "Sorasaki · version free") },
  { nomes: ["setdononome"], ...DONO, desc: "nome", run: mudarConfig("nomeDono", "IVAD") },

  {
    nomes: ["botoes"], ...DONO, desc: "1/0",
    run: async (c) => {
      const v = c.args[0];
      if (v !== "1" && v !== "0") return c.reply(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
      definir("botoes", v === "1");
      return c.reply(t(v === "1" ? "ativado" : "desativado"));
    },
  },
  {
    nomes: ["maxadv"], ...DONO, desc: "número",
    run: async (c) => {
      const n = Math.floor(Number(c.args[0]));
      if (!(n >= 1 && n <= 20)) return c.reply(`${c.prefixo}maxadv 3`);
      definir("maxAdv", n);
      return c.reply(t("feito"));
    },
  },

  {
    nomes: ["setmenu"], ...DONO, desc: "responda uma foto",
    run: async (c) => {
      const buf = await imagemCitada(c);
      if (!buf) return c.reply(`${c.prefixo}setmenu (responda uma foto)`);
      fs.writeFileSync(path.join(PASTA_DADOS, "menu.jpg"), buf);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["resetmenu"], ...DONO,
    run: async (c) => {
      fs.rmSync(path.join(PASTA_DADOS, "menu.jpg"), { force: true });
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["setfotobot"], ...DONO, desc: "responda uma foto",
    run: async (c) => {
      const buf = await imagemCitada(c);
      if (!buf) return c.reply(`${c.prefixo}setfotobot (responda uma foto)`);
      await c.sock.updateProfilePicture(c.sock.user.id, buf);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["setrecado"], ...DONO, desc: "texto",
    run: async (c) => {
      if (!c.texto) return c.reply(`${c.prefixo}setrecado texto`);
      await c.sock.updateProfileStatus(c.texto);
      return c.reply(t("feito"));
    },
  },

  {
    nomes: ["msgs", "mensagens"], ...DONO,
    run: async (c) => c.reply(`📝 ${c.prefixo}setmsg chave texto\n\n${Object.keys(PADRAO).map((k) => `▸ *${k}*: ${t(k).replace(/\n/g, " / ")}`).join("\n")}`),
  },
  {
    nomes: ["setmsg"], ...DONO, desc: "chave texto",
    run: async (c) => {
      const [chave, ...resto] = c.args;
      if (!chave || !PADRAO[chave] || !resto.length) return c.reply(`${c.prefixo}setmsg ativado ✅ Ligado!\n${c.prefixo}msgs`);
      const texto = c.msg.message?.extendedTextMessage?.text || c.msg.message?.conversation || "";
      definirTexto(chave, texto.slice(texto.indexOf(chave) + chave.length).trim());
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["resetmsg"], ...DONO, desc: "chave",
    run: async (c) => {
      if (!PADRAO[c.args[0]]) return c.reply(`${c.prefixo}resetmsg chave`);
      resetarTexto(c.args[0]);
      return c.reply(t("feito"));
    },
  },

  {
    nomes: ["adddono"], ...DONO, desc: "número",
    run: async (c) => {
      const n = soNumero(c.alvo() || "");
      if (!n) return c.reply(t("marqueAlguem"));
      definir("dono", [...new Set([...(cfg().dono || []).map(soNumero), n])]);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["rmdono"], ...DONO, desc: "número",
    run: async (c) => {
      const n = soNumero(c.alvo() || "");
      const lista = (cfg().dono || []).map(soNumero).filter((x) => x !== n);
      if (!lista.length) return c.reply("⚠️ Precisa ficar pelo menos 1 dono.");
      definir("dono", lista);
      return c.reply(t("feito"));
    },
  },

  {
    nomes: ["bc", "transmitir"], ...DONO, desc: "texto",
    run: async (c) => {
      if (!c.texto) return c.reply(`${c.prefixo}bc texto`);
      const grupos = Object.keys(await c.sock.groupFetchAllParticipating());
      for (const g of grupos) {
        await c.sock.sendMessage(g, { text: `📢 ${c.texto}` }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2500));
      }
      return c.reply(`✅ ${grupos.length}`);
    },
  },
  {
    nomes: ["entrar"], ...DONO, desc: "link",
    run: async (c) => {
      const codigo = (c.texto.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/) || [])[1];
      if (!codigo) return c.reply(`${c.prefixo}entrar https://chat.whatsapp.com/...`);
      await c.sock.groupAcceptInvite(codigo);
      return c.reply(t("feito"));
    },
  },
  {
    nomes: ["sairgp"], ...DONO, grupo: true,
    run: async (c) => { await c.reply("👋"); return c.sock.groupLeave(c.jid); },
  },
  {
    nomes: ["listagp"], ...DONO,
    run: async (c) => {
      const gs = Object.values(await c.sock.groupFetchAllParticipating());
      return c.reply(gs.map((g, i) => `${i + 1}. ${g.subject} · ${g.participants.length}`).join("\n") || "—");
    },
  },
  {
    nomes: ["reiniciar"], ...DONO,
    run: async (c) => { await c.reply("🔄"); setTimeout(() => process.exit(0), 1000); },
  },
];
