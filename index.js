import { iniciar } from "./src/conexao.js";

process.on("uncaughtException", (e) => console.error("[erro]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[erro]", e?.message || e));

iniciar();
