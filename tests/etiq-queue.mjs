/**
 * Cola de etiquetas con datos de prueba. No toca Supabase ni una OV real.
 *   node tests/etiq-queue.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createService, memoryRepo } from '../etiq/queue.mjs';
import { CLIENTES } from '../etiq/label-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OV = {
  id: 'ov-prueba-1',
  order_number: 'PRUEBA-SO-0001',
  org: 'ORG-PRUEBA',
  lineas: [
    { sku: 'PRUEBA-SKU', nombre: 'PRODUCTO DE PRUEBA', cod_prov: 'PROV-TEST', categoria: 'CATEGORIA PRUEBA', linea: 'LINEA PRUEBA', cantidad: 2, item_type: 'product' },
    { sku: 'SERV-PRUEBA', nombre: 'SERVICIO DE PRUEBA', cantidad: 1, item_type: 'service' }
  ]
};
const AJENA = {
  id: 'ov-ajena',
  order_number: 'PRUEBA-SO-AJENA',
  org: 'OTRA-ORG',
  lineas: [{ sku: 'AJENA', nombre: 'PRODUCTO AJENO', cantidad: 1, item_type: 'product' }]
};

function actor(extra) {
  return Object.assign({
    id: 'usr-prueba',
    nombre: 'USUARIO_PRUEBA',
    rol: 'usuario',
    modulos: ['inventario', '~prep.e.etiq=1']
  }, extra || {});
}
function canOv(a, ov) { return !!(a && ov && ov.org === 'ORG-PRUEBA'); }
function boot(now) {
  const repo = memoryRepo();
  repo.putOv(OV);
  repo.putOv(AJENA);
  const a = actor();
  repo.putActor(a);
  return {
    repo: repo,
    svc: createService(repo),
    ctx: { actor: a, canOv: canOv, now: () => now || 1000000 },
    bridge: { bridge: { role: 'bridge', id: 'br-prueba', credential: 'bridge_token', revoked: false }, canOv: canOv, now: () => now || 1000000 }
  };
}
function key() { return 'print:ov-prueba-1:PRUEBA-SKU|2'; }

async function enq(s, extra) {
  return s.svc.handle('enqueue', Object.assign({ ov_id: OV.id, idempotency_key: key() }, extra || {}), s.ctx);
}
async function beat(s, online, now) {
  const ctx = Object.assign({}, s.bridge, { now: () => now || s.ctx.now() });
  return s.svc.handle('heartbeat', { printer_online: online }, ctx);
}
async function take(s, now) {
  const ctx = Object.assign({}, s.bridge, { now: () => now || s.ctx.now() });
  return s.svc.handle('claim', {}, ctx);
}

const s = boot();
const off = boot();
off.ctx.actor = actor({ modulos: ['inventario'] });
off.repo.putActor(off.ctx.actor);
const denied = await off.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key() }, off.ctx);
assert.equal(denied.ok, false);
assert.equal(denied.code, 'sin_permiso');
assert.equal(off.repo.jobs.length, 0);

const admin = boot();
admin.ctx.actor = actor({ rol: 'admin', modulos: ['inventario', 'cotizaciones', 'dashboard'] });
admin.repo.putActor(admin.ctx.actor);
const adminNo = await admin.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key() }, admin.ctx);
assert.equal(adminNo.code, 'sin_permiso');

const solo = boot();
solo.ctx.actor = actor({ modulos: ['~prep.e.etiq=1', 'dashboard'] });
solo.repo.putActor(solo.ctx.actor);
assert.equal((await solo.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key() }, solo.ctx)).code, 'sin_permiso');

const cli = boot();
cli.ctx.actor = actor({ rol: 'cliente', modulos: ['inventario', '~prep.e.etiq=1'] });
cli.repo.putActor(cli.ctx.actor);
assert.equal((await cli.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key() }, cli.ctx)).code, 'sin_permiso');

const ajena = await s.svc.handle('enqueue', { ov_id: AJENA.id, idempotency_key: 'print:ajena' }, s.ctx);
assert.equal(ajena.code, 'ov_ajena');
assert.equal(s.repo.jobs.length, 0);

const poison = await s.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key(), url: 'https://evil.example/x', shell: 'lp' }, s.ctx);
assert.equal(poison.code, 'entrada_rechazada');
assert.equal(s.repo.jobs.length, 0);

const tampered = await s.svc.handle('enqueue', {
  ov_id: OV.id,
  idempotency_key: key(),
  labels: [{ profile: 'bodega', width_mm: 102, height_mm: 57, fields: { nombre: 'NO DEBE SALIR' } }]
}, s.ctx);
assert.equal(tampered.ok, true);
assert.equal(tampered.physically_printed, false);
assert.equal(tampered.job.labels.length, 1);
assert.equal(tampered.job.labels[0].profile, 'clientes');
assert.equal(tampered.job.labels[0].width_mm, CLIENTES.width_mm);
assert.equal(tampered.job.labels[0].height_mm, CLIENTES.height_mm);
assert.equal(tampered.job.labels[0].paper, '30330');
assert.equal(tampered.job.labels[0].fields.nombre, 'PRODUCTO DE PRUEBA');
assert.equal(tampered.job.labels[0].copies, 1);
assert.equal(tampered.job.status, 'queued');

const again = await enq(s);
assert.equal(again.duplicate, true);
assert.equal(again.job.id, tampered.job.id);
assert.equal(s.repo.jobs.length, 1);

const many = boot();
const body = { ov_id: OV.id, idempotency_key: key() };
const races = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(function () { return many.svc.handle('enqueue', body, many.ctx); }));
assert.equal(many.repo.jobs.length, 1);
assert.equal(new Set(races.map(function (r) { return r.job.id; })).size, 1);

const ausente = await s.svc.handle('status', { job_id: tampered.job.id }, s.ctx);
assert.equal(ausente.bridge, 'desconectado');
assert.equal(ausente.printer, 'desconocida');
assert.equal(ausente.job.status, 'queued');
assert.equal(ausente.physically_printed, false);
const noTake = await take(s);
assert.equal(noTake.job, null);
assert.equal(noTake.held, 'sin_latido');
assert.equal(s.repo.getJob(tampered.job.id).status, 'queued');

await beat(s, false);
const offClaim = await take(s);
assert.equal(offClaim.held, 'impresora_offline');
assert.equal(offClaim.bridge, 'conectado');
assert.equal(offClaim.printer, 'offline');
assert.equal(s.repo.getJob(tampered.job.id).status, 'queued');
const vistoOff = await s.svc.handle('status', { job_id: tampered.job.id }, s.ctx);
assert.equal(vistoOff.printer, 'offline');
assert.equal(vistoOff.bridge, 'conectado');

await beat(s, true);
const c1 = take(s);
const c2 = take(s);
const both = await Promise.all([c1, c2]);
const winners = both.filter(function (r) { return r.job; });
assert.equal(winners.length, 1);
assert.equal(winners[0].job.status, 'claimed');
assert.ok(winners[0].attempt_id);
assert.equal(s.repo.jobs.filter(function (j) { return j.status === 'claimed'; }).length, 1);

const claimed = s.repo.getJob(tampered.job.id);
const badTry = await s.svc.handle('report', { job_id: claimed.id, attempt_id: 'otro', outcome: 'accepted', cups_job_id: 'Q-1' }, s.bridge);
assert.equal(badTry.code, 'intento_no_coincide');
assert.equal(s.repo.getJob(claimed.id).status, 'claimed');

const amb = await s.svc.handle('report', { job_id: claimed.id, attempt_id: claimed.attempt_id, outcome: 'ambiguous', cups_job_id: '' }, s.bridge);
assert.equal(amb.job.status, 'ambiguous');
assert.equal(amb.physically_printed, false);
await beat(s, true);
const noReplay = await take(s);
assert.equal(noReplay.job, null);
assert.equal(s.repo.getJob(claimed.id).status, 'ambiguous');

const sinConfirm = await s.svc.handle('retry', { job_id: claimed.id, idempotency_key: 'retry:1', confirm: false }, s.ctx);
assert.equal(sinConfirm.code, 'confirma_reintento');
assert.equal(s.repo.jobs.length, 1);

const retried = await s.svc.handle('retry', { job_id: claimed.id, idempotency_key: 'retry:1', confirm: true }, s.ctx);
assert.equal(retried.ok, true);
assert.equal(retried.job.intent, 'retry');
assert.equal(retried.job.status, 'queued');
assert.notEqual(retried.job.id, claimed.id);
assert.equal(s.repo.getJob(claimed.id).status, 'ambiguous');
const retriedAgain = await s.svc.handle('retry', { job_id: claimed.id, idempotency_key: 'retry:1', confirm: true }, s.ctx);
assert.equal(retriedAgain.duplicate, true);
assert.equal(retriedAgain.job.id, retried.job.id);
assert.equal(s.repo.jobs.length, 2);

await beat(s, true);
const taken = await take(s);
assert.equal(taken.job.id, retried.job.id);
const err = await s.svc.handle('report', { job_id: taken.job.id, attempt_id: taken.attempt_id, outcome: 'send_error' }, s.bridge);
assert.equal(err.job.status, 'send_error');
assert.equal(err.job.cups_job_id, null);
const safe = await s.svc.handle('retry', { job_id: err.job.id, idempotency_key: 'retry:2', confirm: true }, s.ctx);
assert.equal(safe.job.status, 'queued');
assert.equal(s.repo.getJob(err.job.id).status, 'send_error');

await beat(s, true);
const taken2 = await take(s);
assert.equal(taken2.job.id, safe.job.id);
const okCups = await s.svc.handle('report', {
  job_id: taken2.job.id,
  attempt_id: taken2.attempt_id,
  outcome: 'accepted',
  cups_job_id: 'Wireless-PRUEBA-88'
}, s.bridge);
assert.equal(okCups.job.status, 'accepted_by_cups');
assert.equal(okCups.job.cups_job_id, 'Wireless-PRUEBA-88');
assert.equal(okCups.job.physically_printed, false);
assert.equal(okCups.physically_printed, false);
const noAuto = await s.svc.handle('retry', { job_id: okCups.job.id, idempotency_key: 'retry:no', confirm: true }, s.ctx);
assert.equal(noAuto.code, 'no_reintento');
const reprintNo = await s.svc.handle('reprint', { job_id: okCups.job.id, idempotency_key: 'reprint:1', confirm: false }, s.ctx);
assert.equal(reprintNo.code, 'confirma_reimpresion');
assert.equal(s.repo.jobs.filter(function (j) { return j.intent === 'reprint'; }).length, 0);
const reprint = await s.svc.handle('reprint', { job_id: okCups.job.id, idempotency_key: 'reprint:1', confirm: true }, s.ctx);
assert.equal(reprint.job.intent, 'reprint');
assert.equal(reprint.job.reprint, true);
assert.equal(reprint.physically_printed, false);
const reprintDup = await s.svc.handle('reprint', { job_id: okCups.job.id, idempotency_key: 'reprint:1', confirm: true }, s.ctx);
assert.equal(reprintDup.duplicate, true);
assert.equal(reprintDup.job.id, reprint.job.id);

const muddy = await s.svc.handle('report', {
  job_id: 'no-existe',
  attempt_id: 'x',
  outcome: 'accepted',
  cups_job_id: 'Q;rm'
}, s.bridge);
assert.equal(muddy.ok, false);

s.repo.putActor(actor({ modulos: ['inventario'] }));
const later = await s.svc.handle('status', { job_id: okCups.job.id }, Object.assign({}, s.ctx, { actor: s.repo.actor('usr-prueba') }));
assert.equal(later.code, 'sin_permiso');

const rev = boot();
await rev.svc.handle('enqueue', { ov_id: OV.id, idempotency_key: key() }, rev.ctx);
await rev.svc.handle('heartbeat', { printer_online: true }, rev.bridge);
rev.bridge.bridge.revoked = true;
const blocked = await rev.svc.handle('claim', {}, rev.bridge);
assert.equal(blocked.code, 'puente_revocado');
assert.equal(rev.repo.jobs[0].status, 'queued');

const html = fs.readFileSync(join(root, 'index.html'), 'utf8');
const at = html.indexOf("if(tipo==='cliente')");
const slice = html.slice(at, at + 900);
assert.match(slice, /w=51;h=19/);
assert.match(slice, /T\('N'/);
assert.match(slice, /T\('S'/);
assert.match(slice, /T\('L'/);
assert.match(html, /MC_BUILD='606'/);
assert.match(html, /Imprimir etiquetas/);
assert.match(html, /prep\.e\.etiq/);
assert.match(html, /etiq\/panel\.js\?v=582/);
assert.match(html, /Ventas\.etiquetas\(\)/);
assert.match(html, /Ventas\.pqConfirmar\(\)/);
assert.equal(html.includes('service_role'), false);
assert.equal(html.includes('etiq_enqueue'), false);
assert.equal(html.includes("op:'pick'") || html.includes('op:\'pick\''), true);

const panelSrc = fs.readFileSync(join(root, 'etiq/panel.js'), 'utf8');
assert.match(panelSrc, /var LIVE = false/);
assert.equal(panelSrc.includes('fetch('), false);
assert.equal(panelSrc.includes('service_role'), false);
const sandbox = { console: console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(panelSrc, sandbox);
const ui = sandbox.MCEtiq;
assert.equal(ui.LIVE, false);
assert.equal(ui.permisos(['inventario']), false);
assert.equal(ui.permisos(['inventario', '~prep.e.etiq=1']), true);
assert.equal(ui.permisos(['~prep.e.etiq=1']), false);
assert.equal(ui.permisos(['~prep.e.etiq=1'], 'admin'), true);
assert.equal(ui.permisos(['inventario'], 'admin'), false);
const pqFn = html.slice(html.indexOf('function renderPq()'), html.indexOf('function pqAbrir'));
assert.equal(pqFn.includes('etiqCab'), false);
assert.equal(html.includes('function etiqCab'), false);
assert.equal(pqFn.includes('Código para el iMac'), false);
const gear = html.slice(html.indexOf("{k:'admin',ico:'gear'"), html.indexOf("{k:'admin',ico:'gear'") + 1600);
assert.match(gear, /Impresión','impresion'/);
assert.match(gear, /~prep\.e\.etiq=1/);
assert.match(gear, /Configuración','cfg',A/);
const d1 = ui.decide({ permitted: true, live: false, sameKey: false, forbidden: false });
const d2 = ui.decide({ permitted: true, live: false, sameKey: true, forbidden: false });
assert.equal(d1.state, 'servicio_no_publicado');
assert.equal(d1.sent, false);
assert.equal(d1.physically_printed, false);
assert.equal(d2.duplicate, true);
assert.equal(d2.sent, false);
assert.equal(ui.decide({ permitted: false, live: true }).state, 'sin_permiso');
const honest = ui.interpret({ ok: true, etiq: 1, physically_printed: false, bridge: 'conectado', printer: 'lista', job: { id: 'job-prueba', status: 'accepted_by_cups', cups_job_id: 'Q-1', physically_printed: false } });
assert.equal(honest.state, 'aceptado_cups');
assert.equal(honest.physically_printed, false);
assert.equal(ui.texto(honest.state, honest), 'Enviada a impresora');
assert.equal(/ya está impresa|impresa con éxito|impreso físicamente|haya salido|papel/i.test(ui.texto(honest.state, honest)), false);
assert.equal(ui.texto('en_cola'), 'En cola');
assert.equal(/todavía no se envía|Trabajo en cola/i.test(ui.texto('en_cola')), false);
assert.equal(ui.texto('ambiguo'), 'Sin confirmar');
assert.equal(ui.texto('error_envio'), 'Error');
const lie = ui.interpret({ ok: true, text: 'impreso físicamente', job: { status: 'accepted_by_cups' } });
assert.equal(lie.state, 'servicio_no_publicado');
assert.equal(lie.sent, false);
const offUi = ui.interpret({ ok: true, etiq: 1, physically_printed: false, bridge: 'desconectado', printer: 'desconocida', job: { id: 'j', status: 'queued', physically_printed: false } });
assert.equal(offUi.state, 'puente_desconectado');
const prn = ui.interpret({ ok: true, etiq: 1, physically_printed: false, bridge: 'conectado', printer: 'offline', job: { id: 'j', status: 'queued', physically_printed: false } });
assert.equal(prn.state, 'impresora_offline');
const ambUi = ui.interpret({ ok: true, etiq: 1, physically_printed: false, bridge: 'conectado', printer: 'lista', job: { id: 'j', status: 'ambiguous', physically_printed: false } });
assert.equal(ambUi.state, 'ambiguo');
assert.match(ui.boxHtml({ state: 'ambiguo', id: 'ov-prueba-1', order_number: 'PRUEBA-SO-0001', cliente: 'CLIENTE DE PRUEBA' }), /Sin confirmar/);
assert.doesNotMatch(ui.boxHtml({ state: 'ambiguo', id: 'ov-prueba-1' }), /Reintentar|Reimprimir/);
assert.match(ui.boxHtml({ state: 'aceptado_cups', id: 'ov-prueba-1', order_number: 'PRUEBA-SO-0001' }), /Enviada a impresora/);
assert.doesNotMatch(ui.boxHtml({ state: 'aceptado_cups', id: '1' }), /Reimprimir|CUPS/);
assert.match(ui.boxHtml({ state: 'aviso', id: 'ov-prueba-1', order_number: 'PRUEBA-SO-0001', n: 1 }), /Imprimir etiquetas remotas/);
assert.doesNotMatch(ui.boxHtml({ state: 'aviso', id: 'ov-prueba-1' }), /Una etiqueta|AirPrint|Trabajo en cola/);
assert.doesNotMatch(ui.boxHtml({ state: 'aviso', id: 'ov-prueba-1', order_number: 'PRUEBA-SO-0001', n: 1, code: 'NOMOSTRAR' }), /Código para el iMac|NOMOSTRAR/);
assert.equal(panelSrc.includes('console.log'), false);
assert.equal(typeof ui.pair, 'function');

for (const name of fs.readdirSync(join(root, 'etiq'))) {
  const p = join(root, 'etiq', name);
  if (!fs.statSync(p).isFile()) continue;
  const t = fs.readFileSync(p, 'utf8');
  assert.equal(t.includes('service_role'), false, name);
}

console.log('etiq-queue OK');
