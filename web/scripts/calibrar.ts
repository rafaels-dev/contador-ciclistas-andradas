/**
 * Calibração do modelo de visão: roda sugerirCategoria (o mesmo código do
 * app) sobre casos com rótulo humano e mede acerto por classe e custo.
 *
 * Uso (na pasta web/, com o .env da raiz carregado):
 *   node scripts/calibrar.ts DIR_CALIBRACAO modelo1,modelo2 [--sem-contexto] [--sem-dica] [--limite N]
 * DIR_CALIBRACAO contém calibracao.json ([{id, rotulo, yolo, filmstrip, contexto}]).
 * Resultados brutos: DIR_CALIBRACAO/resultados/<modelo>__<variante>.json
 */
import fs from "node:fs";
import path from "node:path";
import { sugerirCategoria, type Sugestao } from "../src/lib/openrouter.ts";

type Caso = { id: string; rotulo: Sugestao; yolo: Sugestao; filmstrip: string; contexto: string; hora: string };

const [dir, listaModelos, ...resto] = process.argv.slice(2);
const semContexto = resto.includes("--sem-contexto");
const semDica = resto.includes("--sem-dica");
const iLimite = resto.indexOf("--limite");
const limite = iLimite >= 0 ? Number(resto[iLimite + 1]) : Infinity;
const variante = `${semContexto ? "filmstrip" : "filmstrip+contexto"}${semDica ? "" : "+dica"}`;

const casos = (JSON.parse(fs.readFileSync(path.join(dir, "calibracao.json"), "utf8")) as Caso[]).slice(0, limite);
fs.mkdirSync(path.join(dir, "resultados"), { recursive: true });

async function rodar(modelo: string) {
  const saida = path.join(dir, "resultados", `${modelo.replace("/", "_")}__${variante}.json`);
  const feitos: Record<string, { categoria: Sugestao | null; confianca: number; custo: number; erro?: string }> =
    fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, "utf8")) : {};
  const pendentes = casos.filter((c) => !feitos[c.id] || feitos[c.id].erro);
  let i = 0;
  const trabalhador = async () => {
    while (i < pendentes.length) {
      const c = pendentes[i++];
      try {
        const r = await sugerirCategoria(
          {
            filmstrip: path.join(dir, c.filmstrip),
            contexto: semContexto ? null : path.join(dir, c.contexto),
            dicaDetector: semDica ? null : c.yolo,
          },
          { modelo },
        );
        feitos[c.id] = { categoria: r.categoria, confianca: r.confianca, custo: r.custo_usd ?? 0 };
      } catch (e) {
        feitos[c.id] = { categoria: null, confianca: 0, custo: 0, erro: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabalhador));
  fs.writeFileSync(saida, JSON.stringify(feitos, null, 1));

  const classes = ["ciclistas", "pedestres", "automoveis", "motocicletas", "descartado"] as const;
  let acertos = 0, acertosYolo = 0, custo = 0, erros = 0;
  const porClasse = Object.fromEntries(classes.map((k) => [k, { n: 0, ok: 0 }]));
  const confusao: Record<string, number> = {};
  for (const c of casos) {
    const r = feitos[c.id];
    custo += r.custo;
    if (r.erro) erros++;
    porClasse[c.rotulo].n++;
    if (r.categoria === c.rotulo) {
      acertos++;
      porClasse[c.rotulo].ok++;
    } else {
      const k = `${c.rotulo}→${r.categoria}`;
      confusao[k] = (confusao[k] ?? 0) + 1;
    }
    if (c.yolo === c.rotulo) acertosYolo++;
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  console.log(
    `\n${modelo} [${variante}]  acerto ${pct(acertos, casos.length)} (YOLO ${pct(acertosYolo, casos.length)})  ` +
      `custo US$ ${custo.toFixed(4)} (${((custo / casos.length) * 1000).toFixed(3)}/mil)  erros ${erros}`,
  );
  console.log("  " + classes.map((k) => `${k} ${pct(porClasse[k].ok, porClasse[k].n)} (n=${porClasse[k].n})`).join(" · "));
  console.log("  confusões: " + Object.entries(confusao).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", "));
}

for (const modelo of listaModelos.split(",")) await rodar(modelo);
