/**
 * Dashboard «Utilidad real» con contabilidad Migo (switch ~dash.e.utilidad_real).
 * Menú desplegable cerrado por defecto; sigue el período del dashboard (Hoy/Semana/Mes/Año/rango).
 *   node tests/utilidad-real.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");

assert.match(html, /Ac\('dash\.e\.utilidad_real'/);
assert.match(html, /k==='dash\.e\.utilidad_real'/);
assert.match(html, /MCUtilReal\.mount\('dvu'\)/);
assert.match(html, /periodo:function\(\)\{var rg=rango\(tab\)/);
assert.match(html, /var MC_BUILD='728'/);

assert.match(html, /b728 t2153u/);
const i = html.indexOf("var MCUtilReal=(function(){");
const j = html.indexOf("\n  var DashV2=(function(){", i);
assert.ok(i > 0 && j > i, "MCUtilReal block not found");
const src = html.slice(i, j);
assert.doesNotMatch(src, /Todo el año/);

function cuentas() {
  const c = [];
  const add = (mes, cod, nom, grupo, monto) => c.push({ mes, cod, nom, grupo, monto });
  for (const m of [1, 2, 3, 4]) {
    add(m, "4.1.1.01.02", "Ventas", "ventas", 1000);
    add(m, "4.1.1.01.05", "(-)Descuento", "descuentos", -100);
    add(m, "5.1.1.01.02", "Costo de Venta", "costo", 500);
    add(m, "5.1.2.01.03.27", "Gasto Adm. ISD", "administrativos", 50);
    if (m < 4) add(m, "5.1.2.01.01.01", "Gasto Adm. Sueldos", "administrativos", 100);
    add(m, "5.2.1.01.03", "Gasto por Servicios Bancarios", "bancarios", 10);
  }
  return c;
}
function montar(modulos, rol = "admin") {
  const el = { innerHTML: "" };
  const calls = [];
  const g = {
    document: { getElementById: () => el },
    getProfile: () => ({ rol, modulos }),
    MCPtoks: (m) => (typeof m === "string" ? m.split(",") : m || []).map((x) => String(x).trim()).filter(String),
    getUserName: () => "EFCH", getPin: () => "",
    MCpost: (p) => { calls.push(p); return Promise.resolve({ ok: true, anio: 2026, anios: [2026], cuentas: cuentas(), sistema: [{ mes: 1, facturado: 900, facturas: 1, costo: 500 }, { mes: 2, facturado: 950, facturas: 1, costo: 500 }, { mes: 4, facturado: 900, facturas: 1, costo: 500 }], inventario: { meses: [{ mes: 1, recibido: 600, despachado: 500, devuelto: 0, otros: 0, neto: 100 }], inicio_anio: 1000, valuacion_actual: 1100 }, carga: { cargado_en: "2026-11-25T21:10:47Z", panel: { ingresos: 3600, egresos: 3000, fecha: "2026-11-25" } } }); },
  };
  g.MCcan = (k) => k === "dash.e.utilidad_real" && g.MCPtoks(g.getProfile().modulos).indexOf("~dash.e.utilidad_real=1") >= 0;
  const M = new Function(...Object.keys(g), src + "\nreturn MCUtilReal;")(...Object.values(g));
  return { M, el, calls };
}

test("apagado: no pide datos ni pinta nada (también admin)", async () => {
  const { M, el, calls } = montar(["dashboard"]);
  M.mount("dvu");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.innerHTML, "");
  assert.equal(calls.length, 0);
});

test("cliente nunca lo ve aunque tenga el token", async () => {
  const { M, el, calls } = montar(["~dash.e.utilidad_real=1"], "cliente");
  M.mount("dvu");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.innerHTML, "");
  assert.equal(calls.length, 0);
});

test("año: cerrado por defecto; al abrir, utilidad = ingresos − costo − gastos; ISD; aviso; cruce", async () => {
  const { M, el, calls } = montar(["dashboard", "~dash.e.utilidad_real=1"]);
  M.periodo({ tab: "anio", from: "2026-01-01", to: "2026-04-30" });
  M.mount("dvu");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0].op, "migo_pyg");
  let h = el.innerHTML;
  assert.doesNotMatch(h, /Todo el año/);
  assert.match(h, /2026 \(ene–abr\)/);
  // ingresos 4×900=3600; costo 2000; gastos 4×50+3×100+4×10=540 → utilidad 1060 — visible en el encabezado aunque esté cerrado
  assert.match(h, /\$1,060\.00/);
  assert.match(h, /aria-expanded="false"/);
  assert.doesNotMatch(h, /Cruce ventas netas: Migo vs sistema/);
  assert.doesNotMatch(h, /Inventario comprado sin vender/);
  M.abrir();
  h = el.innerHTML;
  assert.match(h, /aria-expanded="true"/);
  assert.match(h, /\$3,600\.00/);
  assert.match(h, /\$2,000\.00/);
  assert.match(h, /\$540\.00/);
  assert.match(h, /incluye ISD/);
  assert.match(h, /Abril aún no está cerrado en Migo: faltan Sueldos/);
  assert.match(h, /Cruce ventas netas: Migo vs sistema/);
  assert.match(h, /Inventario comprado sin vender/);
  assert.match(h, /estimado/);
  M.tog("administrativos");
  assert.match(el.innerHTML, /5\.1\.2\.01\.03\.27/);
});

test("mes: solo ese mes, no el año", async () => {
  const { M, el } = montar(["dashboard", "~dash.e.utilidad_real=1"]);
  M.periodo({ tab: "mes", from: "2026-01-01", to: "2026-01-25" });
  M.mount("dvu");
  await new Promise((r) => setTimeout(r, 0));
  let h = el.innerHTML;
  assert.match(h, /Enero 2026/);
  // enero: ingresos 900, costo 500, gastos 160 → utilidad 240
  assert.match(h, /\$240\.00/);
  assert.doesNotMatch(h, /\$1,060\.00/);
  assert.doesNotMatch(h, /Todo el año/);
  M.abrir();
  h = el.innerHTML;
  assert.match(h, /\$900\.00/);
  assert.doesNotMatch(h, /Ver utilidad por mes/);
  assert.match(h, /Cruce del mes \(Migo vs sistema\): enero 2026/);
});

test("día: no inventa utilidad diaria; avisa que Migo es mensual", async () => {
  const { M, el } = montar(["dashboard", "~dash.e.utilidad_real=1"]);
  M.periodo({ tab: "hoy", from: "2026-04-15", to: "2026-04-15", facturado: { subtotal: 123.45, facturas: 2, utilidad: 40, margenPct: 32.4 } });
  M.mount("dvu");
  await new Promise((r) => setTimeout(r, 0));
  let h = el.innerHTML;
  assert.match(h, /Migo no tiene el día/);
  assert.match(h, /Facturado del día \(sistema, sin IVA\)/);
  assert.match(h, /\$123\.45/);
  // cerrado: la utilidad mensual de abril (340) NO es el titular del día
  assert.doesNotMatch(h, /ur-kv[^>]*>\$340\.00/);
  assert.doesNotMatch(h, /\$1,060\.00/);
  assert.doesNotMatch(h, /Todo el año/);
  M.abrir();
  h = el.innerHTML;
  // abril: ing 900, gas 60 (sin sueldos), util 340 — aparece etiquetada como del mes
  assert.match(h, /Utilidad real de abril 2026 \(el mes de este día\)/);
  assert.match(h, /\$340\.00/);
  assert.match(h, /Abril aún no está cerrado en Migo: faltan Sueldos/);
  assert.match(h, /El cruce es del mes, no del día ni de la semana/);
  assert.doesNotMatch(h, /Ver utilidad por mes/);
});

test("el 1 del mes con pestaña Mes no se trata como día", () => {
  const { M } = montar(["dashboard", "~dash.e.utilidad_real=1"]);
  const C = M._clasifica({ tab: "mes", from: "2026-11-01", to: "2026-11-01" });
  assert.equal(C.modo, "mes");
  assert.equal(C.lab, "Noviembre 2026");
});
