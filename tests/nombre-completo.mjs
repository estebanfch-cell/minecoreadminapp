import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(html, /var MC_BUILD='596'/);
assert.match(sw, /var SWV='b596'/);

const start = html.indexOf('window.MCnom=(function(){');
const end = html.indexOf('function mcRT()', start);
assert.ok(start > 0 && end > start);
const sandbox = { window: {}, setTimeout() {}, localStorage: { getItem() { return ''; } }, document: { querySelectorAll() { return []; } } };
sandbox.window = sandbox;
vm.runInNewContext(html.slice(start, end), sandbox);
const M = sandbox.MCnom;

M.deUsuario({ nombre: 'EFCH', nombreCompleto: 'Esteban Ferlito' });
M.deUsuario({ nombre: 'Oswal', perfil: { nombreCompleto: 'Oswaldo Peña' } });
assert.equal(M.nom('EFCH'), 'Esteban Ferlito');
assert.equal(M.nom('oswal'), 'Oswaldo Peña');
assert.equal(M.nom('Gabriel Cabrera'), 'Gabriel Cabrera');
assert.equal(M.nom('ZZ'), 'ZZ');
assert.equal(M.nom(''), '');
assert.match(M.quien('EFCH'), /data-mcnom="EFCH"/);
assert.match(M.quien('EFCH'), />Esteban Ferlito</);
assert.match(M.quien('a<b'), /&lt;/);
assert.equal(M.quien('Gabriel Cabrera').includes('Gabriel Cabrera'), true);

assert.match(html, /Recibió '\+esc\(a\.receptor\)/);
assert.match(html, /MCnom\.quien\(a\.entregado_por\)/);
assert.match(html, /MCnom\.quien\(s\.aprobado_por/);
assert.match(html, /MCnom\.quien\(x\.actor/);
assert.match(html, /MCnom\.quien\(a\.contado_por\)/);
assert.match(html, /MCnom\.quien\(a\.firmado_nombre\)/);
assert.match(html, /Preparó: '\+MCnom\.nom\(por\)/);
assert.match(html, /tipo==='prep'\?MCnom\.quien\(x\.por\):e\(x\.por\)/);
assert.match(html, /user:getUserName\(\)/);
assert.doesNotMatch(html, /user:MCnom/);

console.log('nombre-completo ok');
