import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extrae(nombre) {
  const start = html.indexOf('function ' + nombre + '(');
  assert.ok(start > 0, nombre);
  let i = html.indexOf('{', start);
  let d = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}') { d--; if (!d) return html.slice(start, j + 1); }
  }
  throw new Error('no cierra ' + nombre);
}

const ccDig = new Function(extrae('ccDig') + '\nreturn ccDig;')();
const ccCeros = new Function(extrae('ccCeros') + '\nreturn ccCeros;')();
const ccRank = new Function('ccDig', 'ccCeros', 'mcQ', 'MCcod', extrae('ccRank') + '\nreturn ccRank;')(
  ccDig,
  ccCeros,
  (q, hay) => String(hay).toLowerCase().includes(String(q).toLowerCase()),
  () => ''
);
const ccBusca = new Function('ccDig', extrae('ccBusca') + '\nreturn ccBusca;')(ccDig);

test('980 rellena a 6 y coincide primero con MCOR000980', () => {
  assert.equal(ccDig('980'), '000980');
  assert.equal(ccDig('000980'), '000980');
  assert.equal(ccDig('boyles'), '');
  assert.equal(ccBusca('980'), 'MCOR000980');
  const exacto = { sku: 'MCOR000980', nombre: 'NO-U PUMP', from_sub: '5-C-1' };
  const otro = { sku: 'MCOR000981', nombre: '980 en el nombre', from_sub: '5-C-2' };
  assert.equal(ccRank('980', exacto), 2);
  assert.equal(ccRank('980', otro), 0);
  assert.equal(ccBusca('0461234567890'), '0461234567890');
  assert.equal(ccRank('0461234567890', { sku: 'MCOR000111', nombre: 'x', from_sub: '5-A', barcodes: ['0461234567890'] }), 3);
  assert.equal(ccRank('461234567890', { sku: 'MCOR000111', nombre: 'x', from_sub: '5-A', barcodes: ['0461234567890'] }), 3);
  assert.equal(ccRank('0461234567890', exacto), 0);
  assert.equal(ccRank('boyles', { sku: 'MCOR000111', nombre: 'boyles bros', from_sub: '5-A-1' }), 1);
});

test('una ráfaga de pistola no se queda en la cantidad', () => {
  const ccPistola = new Function(extrae('ccPistola') + '\nreturn ccPistola;')();
  let st = null;
  let valor = '3';
  const code = 'MCOR000980';
  for (let i = 0; i < code.length; i++) {
    const r = ccPistola(st, code[i], 1000 + i * 12, valor);
    st = r.st;
    assert.equal(r.out.prevent, true);
    assert.equal(r.out.valor, '3');
    valor = r.out.valor;
  }
  const fin = ccPistola(st, 'Enter', 1000 + code.length * 12, valor);
  assert.equal(fin.out.scan, 'MCOR000980');
  assert.equal(fin.out.valor, '3');
  assert.equal(fin.out.foco, false);
  let humano = null;
  const uno = ccPistola(humano, '5', 5000, '');
  assert.equal(uno.out.prevent, false);
  const enter = ccPistola(uno.st, 'Enter', 5600, '5');
  assert.equal(enter.out.foco, true);
  assert.equal(enter.out.scan, '');
});

test('559 en la sección enfoca la primera línea sin contar', () => {
  const ccElegirLinea = new Function(extrae('ccElegirLinea') + '\nreturn ccElegirLinea;')();
  const a = { id: 'a', product_id: 'p559', contado: 5 };
  const b = { id: 'b', product_id: 'p559', contado: null };
  const c = { id: 'c', product_id: 'otro', contado: null };
  assert.equal(ccElegirLinea([a, b, c], 'p559', {}).id, 'b');
  assert.equal(ccElegirLinea([a, c], 'p559', {}).id, 'a');
  assert.equal(ccElegirLinea([c], 'p559', {}), null);
  assert.match(html, /if\(aqui\)\{irCant\(aqui\);return;\}/);
  assert.match(html, /ccElegirLinea\(S\.sec&&S\.sec\.lineas,elegido\.id,S\.dirty\)/);
});

test('escribir no rehace el buscador', () => {
  const filtro = extrae('filtro');
  assert.doesNotMatch(filtro, /rSec\(|setSelectionRange|\.focus\(/);
  assert.match(html, /id="cc-scan" type="text" inputmode="/);
  assert.match(html, /autocapitalize="off" spellcheck="false"/);
  assert.match(html, /id="cc-kb"/);
  assert.match(html, /localStorage\.setItem\('mc_cc_kb'/);
  assert.match(html, /id="cc-add-q" class="cc-add-q" type="text" inputmode="numeric"/);
  assert.match(html, /body=\{op:'cc_buscar',q:q\}/);
  assert.match(html, /p\.por_barcode/);
  assert.match(html, /k==='inv\.e\.historial'/);
  assert.match(html, /Ac\('inv\.e\.historial','Historial del producto','inventario',1\)/);
  assert.match(html, /x\[1\]!=='inv\.e\.historial'/);
});
