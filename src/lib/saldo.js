import { ler, salvar } from "./banco.js";
import { soNumero } from "./config.js";

const carteiras = () => ler("saldo", {});
const centavos = (v) => Math.round(Number(v) * 100) / 100;

export const chavesDe = (...ids) => [...new Set(ids.flat().map(soNumero).filter(Boolean))];

export function saldoDe(...ids) {
  const c = carteiras();
  return centavos(chavesDe(...ids).reduce((t, k) => t + (Number(c[k]) || 0), 0));
}

export function creditar(id, valor) {
  const k = soNumero(id);
  if (!k) return 0;
  const c = carteiras();
  c[k] = centavos((Number(c[k]) || 0) + Number(valor));
  if (c[k] <= 0) delete c[k];
  salvar("saldo");
  return c[k] || 0;
}

export function debitar(ids, valor) {
  const ks = chavesDe(ids);
  if (saldoDe(ks) < centavos(valor)) return false;
  const c = carteiras();
  let falta = centavos(valor);
  for (const k of ks) {
    if (falta <= 0) break;
    const usa = Math.min(Number(c[k]) || 0, falta);
    if (usa > 0) { c[k] = centavos(c[k] - usa); if (c[k] <= 0) delete c[k]; falta = centavos(falta - usa); }
  }
  salvar("saldo");
  return true;
}
