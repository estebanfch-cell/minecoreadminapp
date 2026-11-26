#!/usr/bin/env node
// Synthetic tests only (no real client data). Acceptance of a real past request lives outside the repo.
import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const P = require("../assets/solicitud_parse.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

// 1) PDF-like blob (space-joined, like pdf.js getTextContent().items.join(' '))
const pdfRaw = readFileSync(new URL("./solicitud-synth-pdf.txt", import.meta.url), "utf8");
const pdf = pdfRaw.replace(/\s+/g, " "); // blob como pdf.js actual (items.join(' '))
const oldPdf = P.parsearViejo(pdf);
const r = P.parseSolicitud(pdf);
assert(oldPdf.length <= 2, "el parser viejo no debería sacar las 5 líneas de un blob, sacó " + oldPdf.length);
assert(r.lineas.length === 5, "pdf synth líneas " + r.lineas.length);
assert(P.parserOk(r), "parserOk pdf");
assert(r.meta.items_declarados === 5, "items_declarados");
assert(r.lineas[0].codigo === "CL.99.01.AAA.001" && r.lineas[0].mcor === "MCOR999001" && r.lineas[0].qty === 6, "l1 " + JSON.stringify(r.lineas[0]));
assert(r.lineas[1].mcor === "MCOR999002" && r.lineas[1].qty === 2, "l2");
assert(r.lineas[2].codigo === "CL.99.02.BBB.010" && r.lineas[2].mcor === "MCOR999010" && r.lineas[2].qty === 12, "l3 resorte");
assert(r.lineas[3].mcor === "MCOR999011" && r.lineas[3].qty === 8, "l4 core lifter");
assert(!r.lineas[4].mcor && r.lineas[4].qty === 9 && /ARANDELA/i.test(r.lineas[4].descripcion), "l5 sin MCOR, qty 9 " + JSON.stringify(r.lineas[4]));

// 2) Kluane-like one line per item, sin MCOR
const k = P.parseSolicitud(readFileSync(new URL("./solicitud-synth-kluane.txt", import.meta.url), "utf8"));
assert(k.lineas.length === 3, "kluane " + k.lineas.length);
assert(k.lineas[0].codigo === "01.99.BUS.0001" && k.lineas[0].qty === 4 && !k.lineas[0].mcor, "k1 " + JSON.stringify(k.lineas[0]));
assert(k.lineas[1].codigo === "01.99.BUS.0002" && k.lineas[1].qty === 10, "k2");
assert(/HQ3/.test(k.lineas[2].descripcion) && k.lineas[2].qty === 3, "k3 " + JSON.stringify(k.lineas[2]));

// 3) CSV / text
const csv = readFileSync(new URL("./solicitud-synth.csv", import.meta.url), "utf8");
const c = P.parseSolicitud(csv);
assert(c.lineas.length === 2, "csv " + c.lineas.length);
assert(c.lineas[0].mcor === "MCOR999001" && c.lineas[0].qty === 6, "csv1");
assert(c.lineas[1].mcor === "MCOR999002" && c.lineas[1].qty === 2, "csv2");

// 4) helpers
assert(P.normMcor("mcor 803") === "MCOR000803", "norm " + P.normMcor("mcor 803"));
assert(P.normMcor("MCOR-000803") === "MCOR000803", "norm dash");
assert(P.parseQty("1.000") === 1000, "miles ES");
assert(P.parseQty("1,5") === 1.5, "decimal ES");
assert(P.parserOk(r, "image") === false, "fotos no se dan por buenas solo con el parser de texto");

// 5) no inventar MCOR
assert(r.lineas.every((l) => !l.mcor || /^MCOR999/.test(l.mcor)), "solo MCOR del texto");
assert(!r.lineas[4].mcor, "línea sin código nuestro queda sin mcor");

// 6) Excel volcado a CSV (igual que el backend con xlsx)
import { execFileSync } from "child_process";
const csvX = execFileSync("python3", ["-c", "import openpyxl,csv,sys\nwb=openpyxl.load_workbook(sys.argv[1],data_only=True); ws=wb.active; w=csv.writer(sys.stdout)\nfor row in ws.iter_rows(values_only=True): w.writerow([\"\" if c is None else c for c in row])\n", new URL("./solicitud-synth.xlsx", import.meta.url).pathname], {encoding:"utf8"});
const x = P.parseSolicitud(csvX);
assert(x.lineas.length===3 && x.lineas[0].mcor==="MCOR999001" && x.lineas[0].qty===6 && x.lineas[2].qty===12, "xlsx "+JSON.stringify(x.lineas));

console.log("OK solicitud-parse.mjs  (pdf blob, kluane, csv, xlsx, helpers)");
