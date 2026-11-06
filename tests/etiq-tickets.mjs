import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'etiq/panel.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sandbox = { console, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const ui = sandbox.MCEtiq;

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OV = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('por defecto hay un ticket por producto y una por unidad copia el pedido', () => {
  const rows = ui.filasOv({ lineas: [
    { id: A, product_id: A, sku: 'MCOR001184', nombre: 'Adaptador', quantity: 6, item_type: 'stocked' },
    { id: B, product_id: B, sku: 'MCOR000559', nombre: 'Otro', quantity: 2, item_type: 'stocked' },
    { id: 'no', product_id: 'x', sku: 'SERV', quantity: 1, item_type: 'service' }
  ]});
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.tickets), [1, 1]);
  assert.equal(ui.totalTickets(rows), 2);
  ui.unaPorUnidad(rows);
  assert.deepEqual(rows.map((r) => r.tickets), [6, 2]);
  rows[1].on = false;
  rows[0].tickets = 2;
  assert.equal(ui.totalTickets(rows), 2);
  assert.equal(JSON.stringify(ui.trozos(2)), '[2]');
  assert.equal(JSON.stringify(ui.trozos(25)), '[20,5]');
});

test('imprimir solo manda las líneas marcadas y no toca la orden', () => {
  assert.match(html, /MCEtiq\.elegir\(cur\)/);
  assert.match(html, /Ventas\.etiqLinea/);
  assert.match(src, /No cambia la cantidad de la orden ni el stock/);
  assert.match(src, /copies: j\.copies/);
  assert.doesNotMatch(src, /op:\s*'save'|quantity:\s*r\.tickets/);
  const posts = [];
  sandbox.getProfile = function () { return { rol: 'admin', modulos: ['~prep.e.etiq=1'] }; };
  sandbox.MCpost = function (p) { posts.push(p); return Promise.resolve({ ok: true, etiq: 1, physically_printed: false, job: { id: A, status: 'queued' } }); };
  sandbox.document = {
    getElementById: function () { return { className: '', textContent: '', innerHTML: '' }; },
    createElement: function () { return { id: '', className: '', innerHTML: '' }; },
    head: { appendChild: function () {} },
    body: { appendChild: function () {} }
  };
  ui.elegir({
    orden: { id: OV, order_number: 'MCOR-SO-001226-3', is_quote: false, is_cancelled: false },
    lineas: [
      { id: A, product_id: A, sku: 'MCOR001184', nombre: 'Pieza', quantity: 6, item_type: 'stocked' },
      { id: B, product_id: B, sku: 'MCOR000559', nombre: 'Otro', quantity: 2, item_type: 'stocked' }
    ]
  });
  ui.tixOn(1, false);
  ui.tixSet(0, '2');
  ui._paso = 1;
  ui.enviar();
  return new Promise((ok) => setTimeout(ok, 30)).then(() => {
    const env = posts.filter((p) => p.op === 'etiq_enqueue');
    assert.equal(env.length, 1);
    assert.equal(env[0].line_id, A);
    assert.equal(env[0].copies, 2);
    assert.equal(env[0].ov_id, OV);
    assert.equal(posts.some((p) => p.op === 'save' || p.op === 'pick'), false);
  });
});
