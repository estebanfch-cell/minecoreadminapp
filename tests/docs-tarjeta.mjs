/**
 * Documentos subidos se renderizan como tarjeta (switch ~ov.e.docs_tarjeta).
 *   node tests/docs-tarjeta.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");

assert.match(html, /var MC_BUILD='713'/);
assert.match(sw, /var SWV='b713'/);
assert.match(html, /function mcDocsTarjetaOn/);
assert.match(html, /~ov\.e\.docs_tarjeta=1/);
assert.match(html, /Ac\('ov\.e\.docs_tarjeta'/);
assert.match(html, /k==='ov\.e\.docs_tarjeta'/);
assert.match(html, /Subido por:/);

const start = html.indexOf("function mcDocsTarjetaOn");
const end = html.indexOf("\nfunction mcDocsTarjetaCss") ;
assert.ok(start > 0);
const libSrc = html.slice(html.indexOf("function mcDocTit"), html.indexOf("/* b713 t2095u: documentos subidos como tarjeta"))
  + html.slice(html.indexOf("function mcDocsTarjetaOn"), html.indexOf("\n/*", html.indexOf("function mcDocsTarjetaCss")));
const lib = new Function(libSrc + "\nreturn {mcDocTit,mcDocsTarjetaOn,mcDocsTarjetaFH,mcDocsTarjetaCss};")();

test("fecha ECT con a. m./p. m.", () => {
  const s = lib.mcDocsTarjetaFH("2026-10-27T14:38:00.000Z");
  // 14:38 UTC = 09:38 America/Guayaquil
  assert.match(s, /27\/10\/2026/);
  assert.match(s, /09:38/);
  assert.match(s, /a\.\s*m\./);
  assert.match(s, / ECT$/);
});

test("apagado sin token, también si es admin no se da por hecho (la función mira el token)", () => {
  globalThis.getProfile = () => ({ rol: "admin", modulos: "dashboard" });
  globalThis.MCPtoks = (m) => String(m || "").split(",").map((x) => x.trim()).filter(Boolean);
  assert.equal(lib.mcDocsTarjetaOn(), false);
  globalThis.getProfile = () => ({ rol: "admin", modulos: "~ov.e.docs_tarjeta=1,dashboard" });
  assert.equal(lib.mcDocsTarjetaOn(), true);
  globalThis.getProfile = () => ({ rol: "cliente", modulos: "~ov.e.docs_tarjeta=1" });
  assert.equal(lib.mcDocsTarjetaOn(), false);
});

test("el HTML de la OV no usa el select como título cuando el switch está en el código de tarjeta", () => {
  // branch onT sets tit=esc(mcDocTit(...)) and puts the select in mdoc-tipo, not mdoc-t
  const block = html.slice(html.indexOf("if(onT){tit=esc(mcDocTit({tipo:x.tipo"), html.indexOf("if(cur&&!vtCli()"));
  const onBranch = block.slice(0, block.indexOf("else{tit="));
  assert.match(onBranch, /tit=esc\(mcDocTit/);
  assert.match(onBranch, /class="mdoc-n mdoc-a"/);
  assert.match(onBranch, /class="mdoc-tipo"/);
  assert.match(onBranch, /class="mdoc-x"/);
  assert.match(onBranch, /class="mdoc-tipo">'\+mcDocSel/);
});
