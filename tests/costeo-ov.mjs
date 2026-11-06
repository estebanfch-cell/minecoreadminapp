import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('el aviso está en el costeo y el permiso nace apagado', () => {
  assert.match(html, /var MC_BUILD='575'/);
  assert.match(sw, /var SWV='b575'/);
  assert.match(html, /Con este costeo puedes despachar /);
  assert.match(html, /Ninguna OV abierta se surte con este costeo/);
  assert.match(html, /Completas al llegar/);
  assert.match(html, /ov_atendibles:true/);
  assert.match(html, /Ac\('co\.e\.ov_atendibles','Órdenes que se despachan con este costeo','compras',1\)/);
  assert.match(html, /x\[1\]!=='co\.e\.ov_atendibles'/);
  assert.match(html, /MCcan\('co\.e\.ov_atendibles'\)/);
  assert.match(html, /Solo lectura\. El stock y las órdenes no se modifican/);
  assert.match(html, /tipo!=='costeo_ov'/);
});
