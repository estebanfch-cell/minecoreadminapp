/**
 * Los textos visibles ya no dicen inFlow.
 *   node tests/inflow-textos.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
assert.match(html, /var MC_BUILD='620'/);
assert.match(sw, /var SWV='b620'/);
assert.match(html, /var POCOLS=\['Nº','Proveedor','N° proveedor','Fecha','Estado','Total','Saldo'\]/);
const th = html.slice(html.indexOf("function MCth("), html.indexOf("MCth._o"));
assert.doesNotMatch(th, /inflowclouduser/);
for (const s of [
  "histórico (hasta 30-oct)",
  "Historial (hasta 30-oct) · solo lectura",
  "— (histórico hasta 30-oct)",
  "Adjunto histórico (hasta 30-oct)",
  "Origen histórico (hasta 30-oct)",
  "'Histórico'",
  "Complemento de showroom; no aplica en Minecore.",
  "Esto ya no está disponible:"
]) assert.ok(html.includes(s), s);
for (const s of [
  "histórico (inFlow",
  "Historial de inFlow",
  "'inFlow'",
  ">inFlow<"
]) assert.equal(html.includes(s), false, s);
console.log("OK");
