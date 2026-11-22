import { cfg, soNumero } from "../lib/config.js";
import { enviarComBotoes, imagemDoMenu } from "../lib/botoes.js";
import { CANAL } from "../lib/selo.js";

const TITULOS = { admin: "🛡️ ADMINISTRAÇÃO", brincadeiras: "🎉 BRINCADEIRAS", dono: "👑 DONO", aluguel: "💎 ALUGUEL", geral: "🌸 GERAL" };
const saudacao = () => {
  const h = Number(new Date().toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};

async function lista(categoria) {
  const { LISTA } = await import("./index.js");
  const p = cfg().prefixo;
  return LISTA.filter((c) => c.categoria === categoria).map((c) => `┃ ${p}${c.nomes[0]}${c.desc ? ` _${c.desc}_` : ""}`).join("\n");
}

async function submenu(c, categoria) {
  const k = cfg();
  const extra = categoria === "dono" ? `\n┃ ${k.prefixo}menudonojogos _RPG_` : "";
  const texto = `╭━━━ ${TITULOS[categoria]} ━━━\n${await lista(categoria)}${extra}\n╰━━━━━━━━━━━━━━━`;
  return enviarComBotoes(c.sock, c.jid, { texto, botoes: [{ texto: "🏠 Menu", id: `${k.prefixo}menu` }] }, c.msg);
}

export default [
  {
    nomes: ["menu", "help", "comandos"], categoria: "menus", livre: true, semAluguel: true,
    run: async (c) => {
      const k = cfg();
      const p = k.prefixo;
      const texto = [
        `╭━━━ 🌸 *${k.nomeBot.toUpperCase()}* 🌸 ━━━`,
        `┃ ${saudacao()}, @${soNumero(c.autor)}!`,
        `┃ 🏷️ version free`,
        `┃ 👑 ${k.nomeDono}`,
        `┃ 🔣 Prefixo: ${p}`,
        `┃ 📢 ${CANAL.link}`,
        `┣━━━━━━━━━━━━━━━`,
        `┃ ${p}menuadm`,
        `┃ ${p}menubn`,
        `┃ ${p}menurpg`,
        ...(c.isDono ? [`┃ ${p}menudono`] : []),
        `┃ ${p}menualuguel`,
        `┣━━━━━━━━━━━━━━━`,
        await lista("geral"),
        `╰━━━━━━━━━━━━━━━`,
      ].join("\n");
      return enviarComBotoes(c.sock, c.jid, {
        texto,
        imagem: imagemDoMenu(),
        mencoes: [c.autor],
        botoes: [
          { texto: "🛡️ Administração", id: `${p}menuadm` },
          { texto: "🎉 Brincadeiras", id: `${p}menubn` },
          { texto: "🎮 RPG", id: `${p}menurpg` },
          ...(c.isDono ? [{ texto: "👑 Dono", id: `${p}menudono` }] : []),
          { texto: "📢 Canal", url: CANAL.link },
        ],
      }, c.msg);
    },
  },
  { nomes: ["menuadm", "menuadmin", "adm"], categoria: "menus", grupo: true, admin: true, livre: true, run: (c) => submenu(c, "admin") },
  { nomes: ["menubn", "menubrincadeiras", "brincadeiras"], categoria: "menus", livre: true, run: (c) => submenu(c, "brincadeiras") },
  { nomes: ["menualuguel"], categoria: "menus", livre: true, semAluguel: true, run: (c) => submenu(c, "aluguel") },
  { nomes: ["menudono", "donomenu"], categoria: "menus", dono: true, semAluguel: true, run: (c) => submenu(c, "dono") },
];
