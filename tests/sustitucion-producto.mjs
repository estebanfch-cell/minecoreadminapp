/**
 * Sustitución de producto en costeo (switch ~costeo.e.sustitucion).
 *   node tests/sustitucion-producto.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");

assert.match(html, /var MC_BUILD='718'/);
assert.match(sw, /var SWV='b718'/);
assert.match(html, /function mcCosteoSustOn/);
assert.match(html, /~costeo\.e\.sustitucion=1/);
assert.match(html, /Ac\('costeo\.e\.sustitucion'/);
assert.match(html, /k==='costeo\.e\.sustitucion'/);
assert.match(html, /Sustituir producto/);
assert.match(html, /function sust\(/);
assert.match(html, /costeo_prod_buscar/);
assert.match(html, /accion:'sustituir'/);
assert.match(html, /_sustRecepBanner/);

const start = html.indexOf("function mcCosteoSustOn");
const end = html.indexOf("\nfunction ", start + 10);
assert.ok(start > 0 && end > start);
const lib = new Function(html.slice(start, end) + "\nreturn {mcCosteoSustOn};")();

test("apagado sin token, también si es admin", () => {
  globalThis.getProfile = () => ({ rol: "admin", modulos: "dashboard" });
  globalThis.MCPtoks = (m) => String(m || "").split(",").map((x) => x.trim()).filter(Boolean);
  assert.equal(lib.mcCosteoSustOn(), false);
  globalThis.getProfile = () => ({ rol: "admin", modulos: "~costeo.e.sustitucion=1,dashboard" });
  assert.equal(lib.mcCosteoSustOn(), true);
  globalThis.getProfile = () => ({ rol: "cliente", modulos: "~costeo.e.sustitucion=1" });
  assert.equal(lib.mcCosteoSustOn(), false);
});
