import fs from "node:fs";
import path from "node:path";

export const PASTA_DADOS = path.resolve("data");
fs.mkdirSync(PASTA_DADOS, { recursive: true });

const cache = new Map();
const timers = new Map();

export function ler(nome, padrao = {}) {
  if (cache.has(nome)) return cache.get(nome);
  const arq = path.join(PASTA_DADOS, `${nome}.json`);
  let dados = padrao;
  try { if (fs.existsSync(arq)) dados = JSON.parse(fs.readFileSync(arq, "utf8")); } catch { dados = padrao; }
  cache.set(nome, dados);
  return dados;
}

export function salvar(nome) {
  clearTimeout(timers.get(nome));
  timers.set(nome, setTimeout(() => {
    const arq = path.join(PASTA_DADOS, `${nome}.json`);
    const tmp = `${arq}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(cache.get(nome) ?? {}, null, 2));
      fs.renameSync(tmp, arq);
    } catch (e) { console.error("[banco]", e.message); }
  }, 500));
}

export function grupo(jid) {
  const todos = ler("grupos", {});
  const g = (todos[jid] ||= {});
  const padrao = { antilink: false, antipalavrao: false, palavras: [], bemvindo: false, legendabv: "", legendasaiu: "", fotobv: "perfil", soadm: false, advs: {}, parceria: false, parceiros: {}, listanegra: [] };
  for (const [k, v] of Object.entries(padrao)) if (g[k] === undefined) g[k] = structuredClone(v);
  return g;
}
export const salvarGrupo = () => salvar("grupos");
