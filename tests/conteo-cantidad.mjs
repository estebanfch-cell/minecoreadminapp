import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('la cantidad vacía es casilla verde y la medida no cambia', () => {
  assert.match(html, /var MC_BUILD='575'/);
  assert.match(sw, /var SWV='b575'/);
  assert.match(html, /cc-vacio/);
  assert.match(html, /html body #cc input\.cc-q\.cc-vacio\{background:rgba\(183,243,74,\.16\)!important;border:2px solid #b7f34a!important\}/);
  assert.match(html, /width:58px!important/);
  assert.match(html, /height:40px!important/);
  assert.match(html, /classList\.toggle\('cc-vacio',String\(v\)===''\)/);
  assert.match(html, /cc-q\.cc-dirty\{border-color:#f0c040/);
});
