/** b680 t1913: Preparar orden no muestra la -2 con el stock que necesita la -1.  node tests/preparar-split.mjs */
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const L = readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('\n');
const i = L.findIndex((x) => x.startsWith('function mcPqNetoSplit(')); let j = i; while (!L[j].startsWith('function MCactLect(')) j++;
const c = vm.createContext({}); vm.runInContext(L.slice(i, j).join('\n'), c);
const ok = (b, m) => { console.log((b ? 'OK  ' : 'FALLA ') + m); if (!b) process.exitCode = 1; };
const ln = (pend, disp, st) => ({ product_id: 'P1', pendiente: pend, disponible: disp, subs: [{ sub: 'A', stock: st }] });
// stock 5; -1 pide 5 (sin preparar), -2 pide 3 → el servidor dice disponible 3 a la -2
let out = c.mcPqNetoSplit([{ so: 'a', order_number: 'MCOR-SO-1000-1', location_id: 'B', lineas: [ln(5, 5, 5)] }, { so: 'b', order_number: 'MCOR-SO-1000-2', location_id: 'B', lineas: [ln(3, 3, 5)] }]);
ok(out.length === 1 && out[0].so === 'a', 'la -2 desaparece mientras la -1 consume todo el stock');
// stock 8: la -2 queda parcial/available con lo que sobra
out = c.mcPqNetoSplit([{ so: 'a', order_number: 'X-1', location_id: 'B', lineas: [ln(5, 5, 8)] }, { so: 'b', order_number: 'X-2', location_id: 'B', lineas: [ln(3, 3, 8)] }]);
ok(out.length === 2 && out[1].lineas[0].disponible === 3 && out[1].disponibilidad === 'available', 'con stock de sobra la -2 sí aparece');
// órdenes sin hermanas: sin cambios
const solo = [{ so: 'z', order_number: 'MCOR-SO-2000', location_id: 'B', lineas: [ln(4, 2, 2)], disponibilidad: 'partial' }];
ok(JSON.stringify(c.mcPqNetoSplit(JSON.parse(JSON.stringify(solo)))) === JSON.stringify(solo), 'orden sin dividir: idéntica');
// -1 ya preparada (no está en la lista) → la -2 queda como la manda el servidor
out = c.mcPqNetoSplit([{ so: 'b', order_number: 'Y-2', location_id: 'B', lineas: [ln(3, 3, 3)] }]);
ok(out.length === 1, 'si la -1 ya salió de la lista, la -2 aparece');
