import fs from "node:fs";
import path from "node:path";
import { ler, salvar } from "./banco.js";

const base = JSON.parse(fs.readFileSync(path.resolve("config.json"), "utf8"));

export function cfg() {
  return { ...base, ...ler("config", {}) };
}

export function definir(chave, valor) {
  const extra = ler("config", {});
  extra[chave] = valor;
  salvar("config");
}

export const soNumero = (x) => String(x || "").split("@")[0].split(":")[0].replace(/\D/g, "");

export function ehDono(...ids) {
  const donos = (cfg().dono || []).map(soNumero).filter(Boolean);
  return ids.map(soNumero).some((n) => n && donos.includes(n));
}
