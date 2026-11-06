import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const bloque = html.match(/\/\* MCHALLAZGO-BEGIN \*\/([\s\S]*?)\/\* MCHALLAZGO-END \*\//);
if (!bloque) throw new Error('falta MCHallazgo');
const window = {};
eval(bloque[1]);
const H = window.MCHallazgo;

const prefs6 = ['6-'];
function ori(extra) {
  return Object.assign({
    key: 'o', linea_id: null, seccion_id: 'sec-a', zona: 'Sección 2', estado_seccion: 'pendiente',
    from_sub: '2-A-1', bodega: 'BODEGA PRINCIPAL', misma_bodega: true, sistema: 1, qty_viva: 1,
    buscar: false, contado: null, otra_sub: null, serials: [], cerrado: false
  }, extra);
}

test('A pendiente luego B hallazgo: cruza la línea y no crea otra', () => {
  const plan = H.proponer([ori({
    key: 'line:1', linea_id: 'line-1', estado_seccion: 'en_conteo', buscar: true, sistema: 1
  })], { prefs: prefs6, destinoSub: '6-B-3', qty: 1 });
  assert.equal(plan.modo, 'cruzar');
  assert.equal(plan.linea_id, 'line-1');
  assert.equal(plan.ajuste, 0);
  assert.equal(plan.aplicaStock, false);
  assert.equal(plan.alta, false);
  assert.equal(plan.segunda_linea, false);
  assert.equal(plan.buscar_sigue, false);
  assert.equal(plan.requiereBuscar, false);
  assert.equal(plan.contado, null);
});

test('la línea abierta se cruza aunque nadie marcó Buscar después', () => {
  const plan = H.proponer([ori({
    key: 'line:2', linea_id: 'line-2', estado_seccion: 'en_conteo', buscar: false
  })], { prefs: prefs6, destinoSub: '6-B-3' });
  assert.equal(plan.modo, 'cruzar');
  assert.equal(plan.linea_id, 'line-2');
  assert.equal(plan.ajuste, 0);
});

test('B hallazgo y A todavía no contada: prepara el origen y el snapshot futuro no duplica', () => {
  const plan = H.proponer([ori({ key: 'sec:a|2-A-1', estado_seccion: 'pendiente', buscar: false, linea_id: null })], {
    prefs: prefs6, destinoSub: '6-B-3', qty: 1
  });
  assert.equal(plan.modo, 'preparar');
  assert.equal(plan.linea_id, null);
  assert.equal(plan.preparar.seccion_id, 'sec-a');
  assert.equal(plan.preparar.from_sub, '2-A-1');
  assert.equal(plan.ajuste, 0);
  assert.equal(plan.alta, false);
  assert.equal(plan.segunda_linea, false);
  assert.equal(plan.aplicaStock, false);
  assert.equal(plan.buscar_sigue, false);
  const preparada = {
    product_id: 'p1', from_sub: '2-A-1', sistema: 1, contado: null, buscar: false,
    otra_sub: '6-B-3', otra_qty: 1
  };
  const futuro = H.aplicarSnapshot([preparada], [
    { product_id: 'p1', sublocation: '2-A-1', q: 1 },
    { product_id: 'p2', sublocation: '2-A-2', q: 4 }
  ]);
  assert.equal(futuro.lineas.filter((l) => l.product_id === 'p1').length, 1);
  assert.equal(futuro.insertadas.length, 1);
  assert.equal(futuro.insertadas[0].product_id, 'p2');
  const linea = futuro.lineas.find((l) => l.product_id === 'p1');
  assert.equal(linea.otra_sub, '6-B-3');
  assert.equal(linea.otra_qty, 1);
  assert.equal(linea.contado, null);
  assert.equal(linea.buscar, false);
  assert.equal(H.ajusteDeSiempre(linea.contado, linea.otra_qty, 0, linea.sistema), 0);
});

test('si el stock del origen crece antes de iniciarlo, el resto sigue pendiente', () => {
  const futuro = H.aplicarSnapshot([
    { product_id: 'p1', from_sub: '2-A-1', sistema: 1, contado: null, buscar: false, otra_sub: '6-B-3', otra_qty: 1 }
  ], [{ product_id: 'p1', sublocation: '2-A-1', q: 3 }]);
  const linea = futuro.lineas[0];
  assert.equal(linea.sistema, 3);
  assert.equal(linea.buscar, true);
  assert.equal(futuro.insertadas.length, 0);
  assert.equal(H.ajusteDeSiempre(null, 1, 0, 3), -2);
});

test('B hallazgo sin pendiente y sin existencias: el mismo producto, sin clon y sin stock', () => {
  const plan = H.proponer([], { prefs: prefs6, destinoSub: '6-B-3', qty: 1 });
  assert.equal(plan.modo, 'sin_existencia');
  assert.equal(plan.alta, true);
  assert.equal(plan.aplicaStock, false);
  assert.equal(plan.segunda_linea, false);
  assert.equal(plan.preparar, undefined);
});

test('varias estanterías no eligen origen solas', () => {
  const plan = H.proponer([
    ori({ key: 'a', from_sub: '2-A-1', zona: 'Sección 2' }),
    ori({ key: 'b', from_sub: '3-C-4', zona: 'Sección 3', seccion_id: 'sec-b' })
  ], { prefs: prefs6, destinoSub: '6-B-3' });
  assert.equal(plan.modo, 'elegir_origen');
  assert.equal(plan.origenes.length, 2);
  assert.equal(plan.escribe, false);
  assert.equal(plan.aplicaStock, false);
  assert.equal(plan.linea_id, undefined);
});

test('cantidad parcial no convierte el resto en falta', () => {
  const plan = H.proponer([ori({ sistema: 3, qty_viva: 3, estado_seccion: 'en_conteo', linea_id: 'L', key: 'L' })], {
    prefs: prefs6, destinoSub: '6-B-3', qty: 1
  });
  assert.equal(plan.modo, 'cruzar');
  assert.equal(plan.qty, 1);
  assert.equal(plan.buscar_sigue, true);
  assert.equal(plan.ajuste, -2);
});

test('varias series no se escogen solas; una serie única sí queda visible', () => {
  const muchas = H.proponer([ori({
    estado_seccion: 'en_conteo', linea_id: 'L', key: 'L',
    serials: [{ serial: 'A', status: 'en_stock' }, { serial: 'B', status: 'en_stock' }]
  })], { prefs: prefs6, destinoSub: '6-B-3', qty: 1 });
  assert.equal(muchas.modo, 'elegir_series');
  assert.equal(muchas.aplicaStock, false);
  const una = H.proponer([ori({
    estado_seccion: 'pendiente', linea_id: null, key: 's',
    serials: [{ serial: 'SOLO', status: 'en_stock' }]
  })], { prefs: prefs6, destinoSub: '6-B-3', qty: 1 });
  assert.equal(una.modo, 'preparar');
  assert.deepEqual(una.serials, ['SOLO']);
});

test('origen en revisión, ya contado o de otra bodega no se escribe', () => {
  const rev = H.proponer([ori({ estado_seccion: 'en_revision', cerrado: true, linea_id: 'L', key: 'L' })], { prefs: prefs6, destinoSub: '6-B-3' });
  assert.equal(rev.modo, 'origen_cerrado');
  assert.equal(rev.aplicaStock, false);
  const contado = H.proponer([ori({ estado_seccion: 'en_conteo', linea_id: 'L', key: 'L', contado: 1 })], { prefs: prefs6, destinoSub: '6-B-3' });
  assert.equal(contado.modo, 'ya_contado');
  const fuera = H.proponer([ori({ seccion_id: null, misma_bodega: false, key: 'f' })], { prefs: prefs6, destinoSub: '6-B-3' });
  assert.equal(fuera.modo, 'fuera');
  assert.equal(fuera.alta, false);
});

test('el portal deja el permiso apagado y no cambia el cierre ni cancela una sección', () => {
  assert.match(html, /var MC_BUILD='572'/);
  assert.match(sw, /var SWV='b572'/);
  assert.match(html, /Ac\('co\.e\.hallazgo'/);
  assert.match(html, /function MCea\(k\)\{return \/\\\.e\\\./);
  assert.match(html, /hallazgoOn\(\)/);
  assert.match(html, /if\(hallazgoOn\(\)\)body\.seccion/);
  assert.match(html, /producto\(s\) en «Buscar después»\. Encuéntralos antes de terminar la sección/);
  assert.doesNotMatch(html, /cc_sec_cancelar|cc_sec_abandonar/);
  assert.match(html, /¿Cancelar el conteo general/);
  assert.match(html, /Sin existencias registradas/);
  assert.match(html, /Hay varias estanterías/);
  assert.match(html, /queda anotado ahí/);
});
