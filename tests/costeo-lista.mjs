import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
const sw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../sw.js'), 'utf8');
const bloque = html.match(/\/\* MCCOSTEO-FMT-BEGIN \*\/([\s\S]*?)\/\* MCCOSTEO-FMT-END \*\//);
assert.ok(bloque);
const window = {};
eval(bloque[1]);
const F = window.MCCosteoFmt;

function pct(n){return (n * 100).toFixed(2) + '%';}

test('el incremento es sobre el FOB, no sobre el costo en bodega', () => {
  const a = F.incSobreFob(6819.35, 8577.80);
  const b = F.incSobreFob(8100, 11628.66);
  assert.equal(pct(a), '25.79%');
  assert.equal(pct(b), '43.56%');
  assert.equal(pct((8577.80 - 6819.35) / 8577.80), '20.50%');
  assert.notEqual(pct(a), '20.50%');
  assert.equal(F.incSobreFob(0, 100), null);
  assert.equal(F.incSobreFob(100, 80) < 0, true);
});

test('la lista y el detalle usan FOB y costo en bodega, e ignoran el ratio viejo', () => {
  const lista = F.incDe({ FOB: 6819.35, AF: 8577.80, incremento: 0.205 });
  const detalle = F.incDe({ M: 8100, AF: 11628.66, incremento: 0.3034 });
  assert.equal(pct(lista), '25.79%');
  assert.equal(pct(detalle), '43.56%');
  const linea = F.incLin({ J: 100, AH: 125, M: 80, AF: 90, AP: 0.2 });
  assert.equal(pct(linea), '25.00%');
  assert.equal(F.incLin({ M: 100, AF: 125 }), null);
  assert.equal(F.incDe({ incremento: 0.205 }), null);
});

test('varias OCs caben en un botón; una sola también', () => {
  assert.deepEqual(F.listaOcs('MCOR-PO-000382, MCOR-PO-000384'), ['MCOR-PO-000382', 'MCOR-PO-000384']);
  assert.equal(F.etiquetaOcs(2), '2 OCs');
  assert.equal(F.etiquetaOcs(1), '1 OC');
  assert.deepEqual(F.listaOcs(''), []);
  assert.match(html, /class="cst-ocb"/);
  assert.match(html, /etiquetaOcs\(L\.length\)/);
  assert.match(html, /Incremento sobre FOB/);
  assert.match(html, /cst-home/);
  assert.match(html, /var MC_BUILD='619'/);
  assert.match(sw, /var SWV='b619'/);
  assert.deepEqual(F.listaProveedores('BOYLES INTERNATIONAL TRADING CO'), ['BOYLES INTERNATIONAL TRADING CO']);
  assert.deepEqual(F.listaProveedores('BOYLES, INC.'), ['BOYLES, INC.']);
  assert.deepEqual(F.listaProveedores('BOYLES + ACME TOOLS'), ['BOYLES', 'ACME TOOLS']);
  assert.deepEqual(F.listaProveedores('', [{proveedor:'ACME TOOLS'}]), ['ACME TOOLS']);
  assert.deepEqual(F.listaProveedores(null), []);
  assert.deepEqual(F.listaProveedores('—'), []);
  assert.equal(F.etiquetaProvs(2), 'Consolidado (2)');
  assert.match(html, /Consolidado \(/);
  assert.match(html, /class="cst-val"/);
  assert.match(html, /costeo_get/);
  const caja = F.menuCaja(12, 220, 390);
  assert.equal(caja.left, 12);
  assert.ok(caja.left + caja.width <= 390 - 8);
  const derecha = F.menuCaja(300, 220, 390);
  assert.ok(derecha.left >= 8);
  assert.ok(derecha.left + derecha.width <= 382);
  assert.match(html, /OV atendibles/);
  assert.match(html, /menuCaja\(r\.left,220,view\)/);
  assert.doesNotMatch(html, /pc\(t\.incremento\)|pc\(T\.incremento\)|pc\(x\.AP\)/);
});
