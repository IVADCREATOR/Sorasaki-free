import { grupo as grupoFree, salvarGrupo as salvarFree } from "../lib/banco.js";

export const grupo = (jid) => grupoFree(jid);
export const salvarGrupo = () => salvarFree();
