/**
 * Ficha: todas las casillas con saldo, «sin sububicación», negativos en rojo y total de bodega.
 *   node --test tests/ficha-casillas.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(join(root, "index.html"), "utf8");
const sw = fs.readFileSync(join(root, "sw.js"), "utf8");

assert.match(html, /var MC_BUILD='717'/);
assert.match(sw, /var SWV='b717'/);

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function mcRound(n){return Math.round(n*100)/100;}

const start = html.indexOf("function pf2Principal");
const end = html.indexOf("function pf2IrOV");
if (start < 0 || end < 0) throw new Error("no se encontraron pf2StkLines/pf2StkHtml");
const api = new Function("esc", "mcRound", html.slice(start, end) + "\nreturn {pf2StkLines, pf2StkHtml, pf2QtyCls};")(esc, mcRound);

const yellow = {
  stock: [
    { bodega: "BODEGA PRINCIPAL", sublocation: "5-C-5", q: 6 },
    { bodega: "BODEGA PRINCIPAL", sublocation: "", q: -3 }
  ],
  sub_defaults: [{ bodega: "BODEGA PRINCIPAL", sub: "5-C-5" }]
};

test("la ficha lista las dos casillas, el total 3 y omite ceros", () => {
  const L = api.pf2StkLines(yellow);
  assert.equal(L.length, 1);
  assert.equal(L[0].bod, "BODEGA PRINCIPAL");
  assert.equal(L[0].q, 3);
  assert.deepEqual(L[0].subs, [
    { sub: "5-C-5", q: 6, blank: false },
    { sub: "sin sububicación", q: -3, blank: true }
  ]);
  const zero = api.pf2StkLines({
    stock: [
      { bodega: "BODEGA PRINCIPAL", sublocation: "5-C-5", q: 3 },
      { bodega: "BODEGA PRINCIPAL", sublocation: "", q: 0 },
      { bodega: "CONSIGNACIÓN", sublocation: "KLUANE", q: 0 }
    ],
    sub_defaults: [{ bodega: "BODEGA PRINCIPAL", sub: "5-C-5" }]
  });
  assert.equal(zero.length, 1);
  assert.deepEqual(zero[0].subs, [{ sub: "5-C-5", q: 3, blank: false }]);
});

test("móvil y escritorio: total de bodega, «sin sububicación» y negativo en rojo", () => {
  const mob = api.pf2StkHtml(yellow, 1);
  const desk = api.pf2StkHtml(yellow, 0);
  for (const h of [mob, desk]) {
    assert.match(h, /BODEGA PRINCIPAL/);
    assert.match(h, />3 u</);
    assert.match(h, /5-C-5/);
    assert.match(h, />6 u</);
    assert.match(h, /sin sububicación/);
    assert.match(h, /pf2-qneg/);
    assert.match(h, />-3 u</);
  }
  assert.match(mob, /pfm-sbtot/);
  assert.match(desk, /pf2-sb-wrap/);
  assert.equal(api.pf2QtyCls(-3), "pf2-q pf2-qneg");
  assert.equal(api.pf2QtyCls(3), "pf2-q");
});

test("otras bodegas también listan casillas distintas de cero, incluso negativas", () => {
  const L = api.pf2StkLines({
    stock: [
      { bodega: "BODEGA PRINCIPAL", sublocation: "5-C-5", q: 3 },
      { bodega: "CONSIGNACIÓN", sublocation: "CONSIGNACIÓN KLUANE", q: -2 },
      { bodega: "CONSIGNACIÓN", sublocation: "OTRA", q: 5 }
    ]
  });
  assert.equal(L.length, 2);
  assert.equal(L[0].bod, "BODEGA PRINCIPAL");
  assert.equal(L[1].bod, "CONSIGNACIÓN");
  assert.equal(L[1].q, 3);
  assert.equal(L[1].subs.length, 2);
  const htmlConsig = api.pf2StkHtml({ stock: L[1].subs.map((s) => ({ bodega: "CONSIGNACIÓN", sublocation: s.blank ? "" : s.sub, q: s.q })) }, 0);
  // just ensure negative class appears for the -2 row via full input
  const full = api.pf2StkHtml({
    stock: [
      { bodega: "BODEGA PRINCIPAL", sublocation: "5-C-5", q: 3 },
      { bodega: "CONSIGNACIÓN", sublocation: "CONSIGNACIÓN KLUANE", q: -2 },
      { bodega: "CONSIGNACIÓN", sublocation: "OTRA", q: 5 }
    ]
  }, 1);
  assert.match(full, /CONSIGNACIÓN/);
  assert.match(full, /pf2-qneg/);
  assert.match(full, />-2 u</);
  assert.match(full, />5 u</);
});
