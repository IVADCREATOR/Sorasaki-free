import crypto from "node:crypto";

const MAX = 2 ** 48 - 1;
export const acaso = () => crypto.randomInt(0, MAX) / MAX;
export const inteiro = (a, b) => crypto.randomInt(a, b + 1);
export const umDe = (lista) => (lista?.length ? lista[crypto.randomInt(0, lista.length)] : undefined);
export function embaralhar(lista) {
  const l = [...lista];
  for (let i = l.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
}
