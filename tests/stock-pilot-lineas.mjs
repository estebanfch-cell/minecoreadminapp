/**
 * Stock Pilot b724 (switch ~sp.e.lineas): foto/info por línea, quitar/restaurar, líneas manuales en todos los niveles, entran a la cotización.
 * OC/cotización: ✕ Quitar línea en el detalle. Interruptor apagado por defecto (también admin).
 *   node tests/stock-pilot-lineas.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const FX = JSON.parse(readFileSync(join(root, "tests", "stock-pilot-lineas.fixture.json"), "utf8"));

test("interruptor registrado y apagado por defecto (también admin)", () => {
  assert.match(html, /Ed\('sp\.e\.lineas'/);
  assert.match(html, /if\(x\[1\]==='sp\.e\.lineas'\)return D\.sub\['sp\.e\.lineas'\]===true;/);
  assert.match(html, /x\[1\]!=='sp\.e\.lineas'/);
  assert.match(html, /k==='sp\.e\.lineas'/);
  assert.match(html, /x\.indexOf\('~sp\.e\.lineas='\)!==0/);
});

const i = html.indexOf("var MCStockPilot=(function(){");
const j = html.indexOf("\nvar Compras=(function(){", i);
const src = html.slice(i, j);
function montar(resp) {
  const el = { innerHTML: "", remove() {} };
  const posts = [], mcposts = [];
  const g = {
    document: { getElementById: (id) => (id === "mc-reco" ? el : null), createElement: () => el, body: { appendChild() {} } },
    getUserName: () => "EFCH", getPin: () => "", getProfile: () => ({ modulos: ["~sp.e.niveles=1", "~sp.e.lineas=1"] }),
    MCsbGet: () => ({ t: "x" }), ocRevPreciosOk: () => false, MCrefLista: () => "", MChistCompra: () => "", MCth: (u) => u,
    fetch: (_u, o) => { const b = JSON.parse(o.body); posts.push(b); const r = b.op === "propuesta" ? resp : b.op === "manual_set" ? { ok: true, linea: { product_id: b.product_id, cant: b.cant, precio: b.precio ?? 10 } } : { ok: true }; return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(r))) }); },
    MCpost: (p) => { mcposts.push(p); return Promise.resolve({ ok: false, error: "test" }); },
    confirm: () => true, alert: () => {}, prompt: () => null, setTimeout, clearTimeout, Compras: { cargarL() {}, abrir() {} },
  };
  const M = new Function(...Object.keys(g), src + "\nreturn MCStockPilot;")(...Object.values(g));
  return { M, el, posts, mcposts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const pie = (h) => (h.match(/<div class="ft"><span[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "";

test("encendido: fotos, MCOR, código proveedor y manuales en Alta; total incluye manuales", async () => {
  const { M, el } = montar(FX);
  M.abrir(); await tick(); await tick();
  M.nivel("alta");
  const h = el.innerHTML;
  const n = FX.lineas.length + FX.manual.length;
  assert.equal((h.match(/class="spc"/g) || []).length, n);
  assert.match(h, /class="ph"><img/);
  assert.match(h, /Cód\. prov\./);
  assert.match(h, /Agregado a mano/);
  assert.match(h, /＋ Agregar producto/);
  const tot = FX.lineas.reduce((a, l) => a + l.cant_alta * l.precio, 0) + FX.manual.reduce((a, x) => a + x.cant * x.precio, 0);
  assert.match(pie(h), new RegExp(n + " líneas"));
  assert.ok(pie(h).includes("$" + tot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })), pie(h));
  for (const k of ["justas", "media", "completa"]) { M.nivel(k); assert.equal((el.innerHTML.match(/Agregado a mano<\/span>/g) || []).length, FX.manual.length, k); }
});

test("quitar y restaurar una línea de la propuesta", async () => {
  const { M, el } = montar(FX);
  M.abrir(); await tick(); await tick(); M.nivel("alta");
  const n = FX.lineas.length + FX.manual.length;
  M.quitar(FX.lineas[0].sku);
  assert.match(pie(el.innerHTML), new RegExp((n - 1) + " líneas"));
  assert.match(el.innerHTML, /Quitadas de este nivel · 1/);
  M.restaurar();
  assert.match(pie(el.innerHTML), new RegExp(n + " líneas"));
});

test("cotizar incluye manuales, excluye quitadas y limpia manuales", async () => {
  const { M, posts, mcposts } = montar(FX);
  M.abrir(); await tick(); await tick(); M.nivel("alta");
  M.quitar(FX.lineas[0].sku);
  M.cotizar(); await tick();
  const p = mcposts.find((x) => x.op === "po_reco_cotizar");
  assert.ok(p);
  assert.equal(p.lineas.length, FX.lineas.length - 1 + FX.manual.length);
  assert.ok(!p.lineas.some((l) => l.product_id === FX.lineas[0].product_id));
  assert.ok(FX.manual.every((m) => p.lineas.some((l) => l.product_id === m.product_id && l.quantity === m.cant)));
});

test("editar cantidad de manual va al servidor (manual_set) y agregar desde búsqueda", async () => {
  const { M, el, posts } = montar(FX);
  M.abrir(); await tick(); await tick(); M.nivel("alta");
  const m0 = FX.manual[0];
  M.edM(m0.product_id, "cant", "7"); await tick(); await tick();
  const s = posts.find((x) => x.op === "manual_set");
  assert.equal(s.cant, 7); assert.equal(s.precio, m0.precio);
  assert.match(el.innerHTML, /value="7"/);
});

test("apagado (lineas_ok false): tabla clásica sin fotos ni agregar", async () => {
  const { M, el } = montar(Object.assign({}, FX, { lineas_ok: false }));
  M.abrir(); await tick(); await tick(); M.nivel("alta");
  assert.doesNotMatch(el.innerHTML, /class="spc"/);
  assert.doesNotMatch(el.innerHTML, /Agregar producto/);
  assert.match(el.innerHTML, /<th>Capa<\/th>/);
});

test("OC/cotización: ✕ Quitar sólo con el interruptor y modo edición", () => {
  assert.match(html, /function pqOk\(\)\{try\{var P=getProfile\(\)\|\|\{\};return PDE\(\)&&\(P\.modulos\|\|\[\]\)\.indexOf\('~sp\.e\.lineas=1'\)>=0;/);
  assert.match(html, /pQl:pQl/);
  assert.match(html, /cur\.lineas\.splice\(i,1\);renderDet\(\);/);
});
