import fs from "node:fs";
import path from "node:path";

const GRANDE = [
  "███████╗ ██████╗ ██████╗  █████╗ ███████╗ █████╗ ██╗  ██╗██╗",
  "██╔════╝██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗██║ ██╔╝██║",
  "███████╗██║   ██║██████╔╝███████║███████╗███████║█████╔╝ ██║",
  "╚════██║██║   ██║██╔══██╗██╔══██║╚════██║██╔══██║██╔═██╗ ██║",
  "███████║╚██████╔╝██║  ██║██║  ██║███████║██║  ██║██║  ██╗██║",
  "╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝",
];

const PEQUENO = [
  "╭─────────────────────────────╮",
  "│                             │",
  "│       S O R A S A K I       │",
  "│        version free         │",
  "│                             │",
  "╰─────────────────────────────╯",
];

const GATO = [
  " /\\_/\\ ",
  "( o.o )",
  " > ^ < ",
];

const CORES = [93, 99, 135, 141, 177, 183];
const cor = (n, t) => `\x1b[38;5;${n}m${t}\x1b[0m`;
const cinza = (t) => `\x1b[38;5;245m${t}\x1b[0m`;
const roxo = (t) => `\x1b[38;5;141m${t}\x1b[0m`;

function versao() {
  try { return JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version || ""; } catch { return ""; }
}

export function mostrarBanner() {
  const largura = process.stdout.columns || 80;
  const grande = largura >= 64;
  const arte = grande ? GRANDE : PEQUENO;
  const pad = grande ? "  " : " ";
  const meio = pad + " ".repeat(Math.max(0, Math.floor((arte[0].length - 7) / 2)));
  const linhas = ["", ...GATO.map((l, i) => meio + cor(CORES[i + 2], l)), ...arte.map((l, i) => pad + cor(CORES[i % CORES.length], l))];
  const v = versao();
  linhas.push("");
  if (grande) {
    linhas.push(`${pad}${roxo("✦")} ${cinza("version free")}${v ? cinza(` · v${v}`) : ""} ${roxo("✦")} ${cinza("by IVAD")}`);
    linhas.push(`${pad}${cinza("canal:")} ${roxo("whatsapp.com/channel/0029VbDgYzOL2AU7jRJrN304")}`);
  } else {
    linhas.push(`${pad}${roxo("✦")} ${cinza(`v${v || "1.0.0"} · by IVAD`)} ${roxo("✦")}`);
  }
  linhas.push("");
  console.log(linhas.join("\n"));
}
