import fs from "node:fs";
import path from "node:path";

export function lerJson(arq, padrao = null) {
  try { return JSON.parse(fs.readFileSync(arq, "utf8")); } catch { return padrao; }
}

export function salvarJson(arq, dados) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, arq);
}
