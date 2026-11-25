/**
 * b726 t2148u/t2149u EFCH: «↩ Volver a revisar» en cotización guardada (switch ~cot.e.revprecios, apagado por defecto, también admin; nunca con $precios=0).
 * Reabre el mismo editor/revisión del cotizador desde la cotización guardada y guarda sobre la misma MCOR-SQ.
 *   node tests/cot-volver-revisar.mjs     (UI completa: python3 tests/cot-volver-revisar-ui.py, guardado simulado)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");

test("interruptor registrado en Usuarios → Cotizaciones y apagado por defecto (también admin)", () => {
  assert.match(html, /Ac\('cot\.e\.revprecios'/);
  assert.match(html, /if\(x\[1\]==='cot\.e\.revprecios'\)return D\.sub\['cot\.e\.revprecios'\]===true;/);
  assert.match(html, /x\[1\]!=='cot\.e\.revprecios'/);
  assert.match(html, /k==='cot\.e\.revprecios'/);
  assert.match(html, /x\.indexOf\('~cot\.e\.revprecios='\)!==0/);
  assert.match(html, /base\.push\('~cot\.e\.revprecios=1'\)/);
});

test("botón solo con token, sin $precios=0, cotización abierta (no convertida ni cancelada)", () => {
  const m = html.match(/function revpOk\(o\)\{[^\n]*?\}\} \/\*/);
  assert.ok(m, "revpOk");
  const f = m[0];
  for (const s of ["o.is_quote", "o.is_cancelled", "'cotizacion'", "'$precios=0'", "'~cot.e.revprecios=1'", "canW('cotizaciones')", "mcEsCliV()", "MCRO()"]) assert.ok(f.includes(s), s);
  assert.match(html, /revpOk\(o\)\?'<button[^']*onclick="Ventas\.volverRevisar\(\)"/);
});

test("reusa el editor del cotizador (editar) en modo 'rev' y conserva precios, plazos y cabecera", () => {
  assert.match(html, /editar\('rev'\)/);
  assert.match(html, /if\(arguments\[0\]==='rev'\)\{form\._rev=\{num:o\.order_number,loc:o\.location_id,pt:o\.payment_terms_id\};/);
  assert.match(html, /\['oc_cliente','sales_rep','plazo_dias','billing_address','shipping_address'\]/);
  assert.match(html, /function sincEnt\(l\)\{if\(form&&form\._rev&&l\._ent0!=null/);
  assert.match(html, /if\(form\._rev\)\{if\(!form\.orden\.location_id\)form\.orden\.location_id=form\._rev\.loc;/);
});

test("sincEnt: en modo revisar el plazo guardado no cambia si no se toca entrega ni cantidad", () => {
  const src = html.match(/  function mcEntSig\(l\)\{[^\n]*/)[0] + "\n" + html.match(/  function sincEnt\(l\)\{[^\n]*/)[0];
  const mk = (form) => new Function("form", "entTexto", src + "\nreturn sincEnt;")(form, () => "RECALCULADO");
  const sig = new Function(html.match(/  function mcEntSig\(l\)\{[^\n]*/)[0] + "\nreturn mcEntSig;")();
  const l = { quantity: 176, entrega: { rev: 1, plazo: "10-15 días" }, plazo_entrega: "72 und. inmediata + 104 und. 10-15 días" };
  l._plz0 = l.plazo_entrega; l._ent0 = sig(l);
  mk({ _rev: {} })(l); assert.equal(l.plazo_entrega, "72 und. inmediata + 104 und. 10-15 días");
  l.entrega = { rev: 1, revp: 1, plazo: "10-15 días" }; mk({ _rev: {} })(l); assert.equal(l.plazo_entrega, "72 und. inmediata + 104 und. 10-15 días", "«Usar este» (revp) no recalcula el plazo");
  l.entrega = { rev: 1, revp: 1, plazo: "30-35 días" }; mk({ _rev: {} })(l); assert.equal(l.plazo_entrega, "RECALCULADO", "si cambia la entrega se recalcula");
  const l2 = { quantity: 1, entrega: {}, plazo_entrega: "X" }; mk({})(l2); assert.equal(l2.plazo_entrega, "RECALCULADO", "fuera de modo revisar: igual que siempre");
});
