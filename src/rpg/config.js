import path from "node:path";
import { cfg } from "../lib/config.js";
import { PASTA_DADOS } from "../lib/banco.js";

const pasta = path.join(PASTA_DADOS, "rpg");

export const CONFIG = {
  get prefixo() { return cfg().prefixo || "#"; },
  get nomeBot() { return cfg().nomeBot || "Sorasaki"; },
  logo: null,
  site: "",
  pastas: { dados: pasta, storage: pasta },
};
