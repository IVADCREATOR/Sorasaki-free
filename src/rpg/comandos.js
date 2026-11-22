import { COMANDOS_ECONOMIA } from "./economia.js";
import { COMANDOS_RPG } from "./rpg.js";
import { COMANDOS_JOGOS, jogosLigados, definirJogos, encerrarPartida } from "./jogos.js";
import { COMANDOS_NIVEIS } from "./niveis.js";
import { t } from "../lib/textos.js";

const extras = [
  {
    nomes: ["modojogos", "ligarjogos"], grupo: true, admin: true,
    run: async (c) => {
      const v = String(c.args[0] || "").toLowerCase();
      if (!["1", "0", "on", "off"].includes(v)) return c.responder(t("usoOnOff", { p: c.prefixo, cmd: c.cmd }));
      const on = v === "1" || v === "on";
      definirJogos(c.jid, on);
      if (!on) encerrarPartida(c.jid);
      return c.responder(t(on ? "ativado" : "desativado"));
    },
  },
  {
    nomes: ["vip", "comprarvip"],
    run: async (c) => c.responder(`💎 Para ser VIP, fale com o dono: ${c.prefixo}dono`),
  },
  {
    nomes: ["ranking"], grupo: true,
    run: async (c) => {
      const livre = c.__free?.COMANDOS?.get("rankzoeira");
      return livre ? livre.run({ ...c.__free.contexto, args: c.args, texto: c.args.join(" ") }) : null;
    },
  },
];

export const LISTA_RPG = [
  ...COMANDOS_RPG,
  ...COMANDOS_ECONOMIA,
  ...COMANDOS_NIVEIS,
  ...COMANDOS_JOGOS.map((d) => ({ ...d, jogo: true })),
  ...extras,
];

export const COMANDOS = new Map();
for (const d of LISTA_RPG) for (const n of d.nomes) if (!COMANDOS.has(n)) COMANDOS.set(n, d);
export { jogosLigados };
