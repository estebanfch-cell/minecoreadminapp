/**
 * t1909: interruptores del portal cliente generados de un registro único (crear/editar/invitación),
 * apagados por defecto, y guardar no borra «liquidacion» ni cambia permisos existentes.
 *   node tests/usuarios-modulos-cliente.mjs   (sin red, sin escribir nada)
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const L = readFileSync(join(root, 'index.html'), 'utf8').split('\n');
const find = (re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i])) return i; throw new Error('no ' + re); };
const blk = (a, b) => L.slice(a, b + 1).join('\n');
const reg0 = find(/^var CMODS_REG=\[/), reg1 = find(/^function mcCliModReg\(/);
const nav0 = find(/^function MC_NAVCAT\(\)/), nav1 = find(/^\}/, nav0);
const no0 = find(/^var MC_CLI_NO_G=/);
const p0 = find(/^var MCP_FINOS=/), u0 = find(/^Users=\(function\(\)\{/), u1 = find(/^\}\)\(\);/, u0);
const ea = find(/^function MCea\(/);
const src = [blk(reg0, reg1), blk(nav0, nav1), blk(no0, no0 + 1), blk(ea, ea), blk(p0, u0 - 1), 'var Users;', blk(u0, u1)].join('\n');
let saved = [];
const el = { innerHTML: '', style: {}, textContent: '', value: '' };
const ctx = {
  console, JSON, Math, Object, Array, String, Promise, Date, RegExp, setTimeout: () => 0,
  document: { getElementById: () => el, querySelectorAll: () => [], addEventListener() {}, hidden: true, createElement: () => el },
  addEventListener() {}, location: { origin: '', pathname: '' }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
  getProfile: () => ({ rol: 'admin', nombre: 'EFCH', modulos: [] }), getUserName: () => 'EFCH',
  MCusr: (p) => { if (p.action === 'saveUser') saved.push(p); return Promise.resolve({ ok: true, usuarios: [], invites: [], clientes: [] }); },
  toast() {}, alert() {}, confirm: () => true, MCultIng: () => '', MCVistaBtn: () => '', MCImpBtn: () => '',
  MCTA: { html: () => '<i>ta</i>' }, mcCliMod: () => false, openMod() {}, mcEsCliV: () => false, getPin: () => true, MCpost: () => new Promise(() => {}), setInterval: () => 1, MCpost0: () => true, MCnavRutaOk: () => true, MCnavOk: () => true, MCnavMaster: () => false, MCnavH: () => ({ ms: [] }),
};
ctx.window = ctx;
vm.createContext(ctx);
const ok = (c, m) => { if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else console.log('OK  ' + m); };

const U = ctx.Users;
// borrador internals vía editor: usamos Users.nuevo + render de editor a través de _D
function editorHtml(u, isNew) { return vm.runInContext('(function(u,n){return Users.__ed?Users.__ed(u,n):null;})', ctx)(u, isNew); }
// Exponer editor/tokens para la prueba
const src2 = src.replace("return {init:init,nuevo:", "return {__ed:function(u,n){D=null;return editor(u,n);},__tok:function(){return tokens();},__D:function(){return D;},__set:function(k,v){D[k]=v;},init:init,nuevo:");
vm.runInContext(src2, ctx, { filename: 'slice2.js' });
const reg = vm.runInContext('mcCliModReg()', ctx).map((r) => r.k);
for (const k of ['inventario', 'cotizaciones', 'estadocuenta', 'consignacion', 'liquidacion', 'entregas', 'cdash', 'proyectos', 'master'])
  ok(reg.includes(k), 'registro incluye ' + k);
// módulo futuro: solo se agrega al registro, sin más código
vm.runInContext("CMODS_REG.push(['futuro','🆕','Módulo futuro','x','fut']);", ctx);
const ed = (u, n) => ctx.Users.__ed(u, n), tok = () => ctx.Users.__tok(), D = () => ctx.Users.__D();
// 1) nuevo cliente: todos los interruptores, todos apagados
let h = ed({ nombre: '', rol: 'cliente', modulos: '', activo: true }, true);
for (const k of [...reg, 'futuro']) ok(h.includes('data-cm="' + k + '"'), 'crear cliente muestra interruptor ' + k);
ok(Object.values(D().cm).every((v) => !v), 'crear: todo apagado por defecto');
let t = tok();
ok(!t.includes('liquidacion') && !t.includes('~cli.e.recibir=1') && t.includes('@cdash=0') && !t.includes('futuro'), 'crear sin tocar: sin módulos de cliente');
ctx.Users.cm('liquidacion', 1); ctx.Users.cm('entregas', 1); ctx.Users.cm('futuro', 1); ctx.Users.cm('master', 1);
t = tok();
ok(t.includes('liquidacion') && t.includes('~cli.e.recibir=1') && t.includes('futuro') && D().master === true, 'encender liquidación/entregas/futuro/máster');
// 2) cliente existente tipo MAURICIO: guardar sin tocar conserva todo (antes se perdía «liquidacion»)
const mods = 'cotizaciones,inventario,estadocuenta,liquidacion,@ventas=1,@inventario=1,$precios=0,~cli.e.recibir=1,@cdash=1,@proyectos=0,~ui.e.vdos=1';
h = ed({ nombre: 'MAURICIO', rol: 'cliente', modulos: mods, activo: true, empresa: 'X', master: true, aprobado: true }, false);
ok(D().cm.liquidacion && D().cm.entregas && D().cm.cdash && D().cm.master && !D().cm.consignacion, 'editar: estado inicial = permisos actuales');
t = tok();
for (const x of ['cotizaciones', 'inventario', 'estadocuenta', 'liquidacion', '~cli.e.recibir=1', '@cdash=1', '@proyectos=0'])
  ok(t.includes(x), 'guardar sin cambios conserva ' + x);
ok(!t.includes('consignacion') && !t.includes('futuro'), 'no agrega módulos que no tenía');
// misma salida que main (b759bc6) salvo «liquidacion», que main borraba
{ const M = (process.env.MAIN_HTML ? readFileSync(process.env.MAIN_HTML, 'utf8') : '').split('\n');
  if (M.length > 1) { const f = (re, a = 0) => { for (let i = a; i < M.length; i++) if (re.test(M[i])) return i; throw new Error(re); };
    const b = (a, z) => M.slice(a, z + 1).join('\n'); const r0 = f(/^var CMODS_REG=\[/), n0 = f(/^function MC_NAVCAT\(\)/), q0 = f(/^var MC_CLI_NO_G=/), P0 = f(/^var MCP_FINOS=/), U0 = f(/^Users=\(function\(\)\{/), U1 = f(/^\}\)\(\);/, U0), E = f(/^function MCea\(/);
    const s2 = [b(r0, f(/^\];/, r0)), b(n0, f(/^\}/, n0)), b(q0, q0 + 1), b(E, E), b(P0, U0 - 1), 'var Users;', b(U0, U1)].join('\n').replace("return {init:init,nuevo:", "return {__ed:function(u,n){D=null;return editor(u,n);},__tok:function(){return tokens();},init:init,nuevo:");
    const c2 = vm.createContext(Object.assign({}, ctx)); c2.window = c2; vm.runInContext(s2, c2);
    c2.Users.__ed({ nombre: 'MAURICIO', rol: 'cliente', modulos: mods, activo: true, empresa: 'X', master: true, aprobado: true }, false);
    const old = c2.Users.__tok().slice().sort(), neu = tok().slice().sort();
    ok(JSON.stringify(old.concat(['liquidacion']).sort()) === JSON.stringify(neu), 'idéntico a main + liquidacion: ' + JSON.stringify(neu));
    ok(!old.includes('liquidacion'), 'confirmado: main borraba liquidacion al guardar'); } }
ctx.Users.cm('liquidacion', 0);
ok(!tok().includes('liquidacion'), 'apagar liquidación la quita');
// 3) equipo: sin bloque cliente
h = ed({ nombre: 'OSWAL', rol: 'usuario', modulos: 'inventario,@inventario=1', activo: true }, false);
ok(!h.includes('data-climods'), 'usuario del equipo sin bloque cliente (sin cambios)');
