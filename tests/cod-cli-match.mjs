// El cruce de códigos: primero la cotización abierta, uno a uno. No toca la base.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'edge-patches', 'cod-cli.ts'), 'utf8');
const ini = src.indexOf('const STOP');
const fin = src.indexOf('Deno.serve');
if (ini < 0 || fin < 0) throw new Error('no está el cruce');
const M = new Function(src.slice(ini, fin) + '\nreturn { proponer, scoreQuote, vocabHit, scoreDesc };')();

const LIFTER = { sku: 'MCOR001081', name: 'HO KH CORE LIFTER SLOTTED - BOYLES BROS', qty: 20, line_num: 7, codigo: '42040012000', product_id: 'lifter' };
const PIN = { sku: 'MCOR000491', name: 'BO/NO/HO/NO PO HEAD SPIRAL PIN (7/16" x 1.125") - BOYLES BROS', qty: 20, line_num: 5, codigo: '42020004020', product_id: 'pin' };
const SPRING = { id: 'spring', sku: 'MCOR000588', name: 'NO/HO/PO OS SAFE LOCK SPRING - BOYLES BROS', codigo: '' };
const prods = [
  { id: 'lifter', sku: LIFTER.sku, name: LIFTER.name, codigo: LIFTER.codigo },
  { id: 'pin', sku: PIN.sku, name: PIN.name, codigo: PIN.codigo },
  SPRING
];
const resorte = { codigo: '01.08.RES.0027', descripcion: 'RESORTE PARA CASITA HQ', qty: 20 };

test('resorte para casita HQ cantidad 20 toma el core lifter libre de la cotización, no el resorte del catálogo', () => {
  const out = M.proponer([resorte], [PIN, LIFTER], prods, new Map());
  assert.equal(out[0].sku, 'MCOR001081');
  assert.equal(out[0].en_cotizacion, true);
  assert.equal(out[0].linea, 7);
  assert.equal(out[0].ya, false);
  assert.ok(out[0].confianza >= 85);
  assert.notEqual(out[0].sku, 'MCOR000588');
});

test('cantidad 20 se reparte: la casita al lifter y el pin al pin', () => {
  const pinLine = { codigo: '01.08.PIN.0001', descripcion: 'ESPIRAL PIN HO', qty: 20 };
  const out = M.proponer([resorte, pinLine], [PIN, LIFTER], prods, new Map());
  assert.equal(out[0].sku, 'MCOR001081');
  assert.equal(out[0].linea, 7);
  assert.equal(out[1].sku, 'MCOR000491');
  assert.equal(out[1].linea, 5);
});

test('el pin de la misma cantidad no se queda con el resorte de casita', () => {
  const soloPin = M.proponer([resorte], [PIN], prods, new Map());
  assert.notEqual(soloPin[0].sku, 'MCOR000491');
  assert.equal(soloPin[0].en_cotizacion, false);
});

test('sin línea plausible en la cotización, el catálogo no elige el core lifter', () => {
  const out = M.proponer([resorte], [], prods, new Map());
  assert.notEqual(out[0].sku, 'MCOR001081');
  assert.equal(out[0].sku, 'MCOR000588');
  assert.equal(out[0].en_cotizacion, false);
});

test('un código ya guardado vuelve solo en la cotización siguiente del mismo cliente', () => {
  const ya = new Map([['01.08.RES.0027', {
    sku: 'MCOR001081', nombre: LIFTER.name, product_id: 'lifter',
    confirmado_por: 'Esteban Orazio Ferlito Chiriboga', confirmado_at: '2026-11-11T12:00:00Z'
  }]]);
  const otra = M.proponer([resorte], [], prods, ya);
  assert.equal(otra[0].ya, true);
  assert.equal(otra[0].confianza, 100);
  assert.equal(otra[0].sku, 'MCOR001081');
  assert.equal(otra[0].en_cotizacion, false);
  const misma = M.proponer([resorte], [LIFTER], prods, ya);
  assert.equal(misma[0].ya, true);
  assert.equal(misma[0].en_cotizacion, true);
  assert.equal(misma[0].linea, 7);
});
