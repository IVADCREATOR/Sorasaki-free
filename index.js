import { iniciar } from "./src/conexao.js";
import { mostrarBanner } from "./src/lib/banner.js";

process.on("uncaughtException", (e) => console.error("[erro]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[erro]", e?.message || e));

mostrarBanner();
iniciar();
