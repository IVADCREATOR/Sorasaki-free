import { iniciar } from "./src/conexao.js";
import { mostrarBanner } from "./src/lib/banner.js";

process.on("uncaughtException", (e) => console.error("[erro]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[erro]", e?.message || e));

let ultimaVolta = 0;
process.on("beforeExit", () => {
  if (Date.now() - ultimaVolta < 5000) return;
  ultimaVolta = Date.now();
  console.log("🔄 A conexão parou. Tentando de novo...");
  setTimeout(iniciar, 3000);
});

mostrarBanner();
iniciar();
