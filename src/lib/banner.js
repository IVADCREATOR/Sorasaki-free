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
  "       *                    .",
  "   .        /\\        /\\        *",
  "           /  \\______/  \\",
  "    *     /              \\    .",
  "         |   (@)    (@)   |",
  "         |  ==    ^   ==  |",
  "          \\     \\__/     /",
  "      .    '-.________.-'      *",
  "           /            \\",
  "          /   |      |   \\",
  "         (    |      |    )~~,",
  "          \\___|______|___/   )",
  "             (__)  (__)   _.'",
];

const CORES = [93, 99, 135, 141, 177, 183];
const DEGRADE = [93, 93, 99, 99, 135, 135, 141, 141, 177, 177, 183, 183, 189];

function pintarGato(l, i) {
  const base = DEGRADE[i % DEGRADE.length];
  return l.replace(/(\*|\.(?=\s|$)|@|[^*@.]+|\.)/g, (t) => {
    if (t === "*") return cor(219, t);
    if (t === "@") return cor(213, t);
    if (t === ".") return cor(225, t);
    return cor(base, t);
  });
}
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
  const desvio = Math.round(arte[0].length / 2 - 17.5);
  const padGato = pad + " ".repeat(Math.max(0, desvio));
  const padArte = pad + " ".repeat(Math.max(0, -desvio));
  const linhas = ["", ...GATO.map((l, i) => padGato + pintarGato(l, i)), ...arte.map((l, i) => padArte + cor(CORES[i % CORES.length], l))];
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
