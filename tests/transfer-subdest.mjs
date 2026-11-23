/**
 * b712 t2094u: «Hacia sub.» automático (predeterminada en destino → más stock en destino → vacío), con interruptor ~stk.e.subdest.
 *   node tests/transfer-subdest.mjs   (simulación, sin servidor ni stock real)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const a = html.indexOf('  window.MCSubDest={'), b = html.indexOf('  function stSubDest(l)');
if (a < 0 || b < 0) throw new Error('helper');
let mods = ['~stk.e.subdest=1'], rol = 'admin';
const window = {};
const getProfile = () => ({ rol, modulos: mods });
const MCPtoks = (m) => m;
eval(html.slice(a, b).replace('window.MCSubDest=', 'window.MCSubDest='));
const S = window.MCSubDest, P = 'a4b0d9f6-9544-4200-aefa-43ed6c027484', C = '164e651f-4ce9-49e5-bfd7-268fd581d661';
const ok = (c, m) => { if (!c) throw new Error(m); console.log('ok', m); };
// MCOR001153 (datos de solo lectura): predeterminadas y stock
const defs = [{ location_id: C, sub: 'CONSIGNACIÓN KLUANE' }, { location_id: P, sub: '2-B' }];
const stock = [{ location_id: P, sublocation: '2-B', stock: 3 }, { location_id: C, sublocation: 'CONSIGNACIÓN KLUANE', stock: 3 }];
ok(S.on(), 'interruptor encendido');
ok(S.pick(P, defs, stock) === '2-B', 'MCOR001153 → BODEGA PRINCIPAL propone 2-B');
ok(S.pick(P, [], [{ location_id: P, sublocation: '1-A', stock: 2 }, { location_id: P, sublocation: '7-C', stock: 9 }, { location_id: C, sublocation: 'X', stock: 50 }]) === '7-C', 'sin predeterminada: la de más stock en destino');
ok(S.pick(P, [], [{ location_id: P, sublocation: '9-Z', q: 0 }, { location_id: C, sublocation: 'X', stock: 5 }]) === '', 'sin nada: vacío');
ok(S.pick(P, [], [{ location_id: P, sublocation: '3-A', q: 4 }]) === '3-A', 'ficha (campo q)');
mods = []; ok(!S.on(), 'apagado por defecto');
mods = ['~stk.e.subdest=1']; rol = 'cliente'; ok(!S.on(), 'nunca para clientes');
ok(html.includes("(stSubDest(l)||l.to_sub_def||'')") && html.includes('stRecAuto();') && html.includes('MCStkEd.dest('), 'transferencia, recepción en tránsito y ficha conectadas');
ok(html.includes("var MC_BUILD='712'") && readFileSync(join(root, 'sw.js'), 'utf8').includes("var SWV='b712'"), 'build 712');
