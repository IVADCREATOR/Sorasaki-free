import menus from "./menus.js";
import geral from "./geral.js";
import admin from "./admin.js";
import protecao from "./protecao.js";
import dono from "./dono.js";
import aluguel from "./aluguel.js";
import brincadeiras from "./brincadeiras.js";
import rpg from "./rpg.js";

export const LISTA = [...menus, ...geral, ...admin, ...protecao, ...dono, ...aluguel, ...brincadeiras, ...rpg];
export const COMANDOS = new Map();
for (const c of LISTA) for (const n of c.nomes) COMANDOS.set(n, c);
