/**
 * Contrato real: cuerpo del navegador → portal-api ventas() → ventas-api.
 * El 411 rechazaba porque el gateway siempre pone actor. Mock de base, sin papel.
 *   node tests/etiq-contrato.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const panelSrc = readFileSync(join(root, 'etiq/panel.js'), 'utf8');
if (!html.includes("['etiq','Imprimir etiquetas remotas']")) throw new Error('Print no tiene la entrada remota');
if (!html.includes("kind==='etiq'")) throw new Error('imprimir no despacha al iMac');

function gateway(browser, sessionUser) {
  const body = {};
  for (const k of Object.keys(browser)) {
    if (!['action', 'user', 'pin', 'token', 'session', 't', 'actor', 'permisos'].includes(k)) body[k] = browser[k];
  }
  body.op = browser.op;
  body.actor = sessionUser;
  if (String(body.op || '').startsWith('etiq_')) {
    for (const k of ['url', 'cmd', 'shell', 'cups_queue', 'lp', 'argv', 'printer', 'destination', 'labels']) delete body[k];
  }
  body.permisos = { costos: false };
  body.es_admin = false;
  return body;
}

function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}
function uuidOk(v) { return /^[0-9a-f-]{36}$/i.test(String(v || '')); }
function entero(v, min, max) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isInteger(n) || n < min || n > max) fail('entrada_rechazada');
  return n;
}
function etiqueta(nombre, sku, qty, ov) {
  return { profile: 'clientes', width_mm: 51, height_mm: 19, paper: '30330', copies: 1, fields: { nombre, sku, qty: String(qty), ov, barcode: sku } };
}

const PID = '6519901f-8c30-4ecf-a4d0-4b13f6916498';
const OVID = '00000000-0000-4000-8000-0000000000aa';
const L1 = '00000000-0000-4000-8000-0000000000b1';
const L2 = '00000000-0000-4000-8000-0000000000b2';
const L3 = '00000000-0000-4000-8000-0000000000b3';

function mockSql(db) {
  const jobs = [];
  const tag = (strings, ...vals) => ({ text: strings.join('?'), vals });
  const sql = async (strings, ...vals) => {
    const q = tag(strings, ...vals);
    const t = q.text;
    if (t.includes('from app.products')) {
      const id = q.vals[0];
      const p = db.products[id];
      return p && p.item_type !== 'service' && p.is_active !== false ? [p] : [];
    }
    if (t.includes('from app.sales_order_lines') && t.includes('l.id=')) {
      const line = q.vals[0];
      const ov = q.vals[1];
      return db.lines.filter((l) => l.id === line && l.ov_id === ov && !l.discarded && l.item_type !== 'service' && l.q > 0);
    }
    if (t.includes('from app.sales_order_lines')) {
      const ov = q.vals[0];
      return db.lines.filter((l) => l.ov_id === ov && !l.discarded && l.item_type !== 'service' && l.q > 0)
        .sort((a, b) => a.line_num - b.line_num)
        .map((l) => ({ sku: l.sku, nombre: l.nombre, qty: l.q }));
    }
    if (t.includes('from app.sales_orders')) {
      const id = q.vals[0];
      const o = db.orders[id];
      return o && !o.cancelled ? [o] : [];
    }
    if (t.includes('where requested_by=')) {
      const actor = q.vals[0];
      const key = q.vals[1];
      return jobs.filter((j) => j.requested_by === actor && j.idempotency_key === key);
    }
    if (t.startsWith('insert into app.etiq_jobs')) {
      const job = {
        id: 'job-' + (jobs.length + 1),
        ov_id: q.vals[0],
        order_number: q.vals[1],
        requested_by: q.vals[2],
        idempotency_key: q.vals[3],
        status: 'queued',
        labels: q.vals[4]
      };
      jobs.push(job);
      return [job];
    }
    throw new Error('sql no prevista ' + t.slice(0, 80));
  };
  sql.json = (v) => v;
  return { sql, jobs };
}

async function enqueue(b, sql, actor) {
  for (const k of ['url', 'cmd', 'shell', 'cups_queue', 'lp', 'argv', 'printer', 'destination']) {
    if (k in (b || {})) fail('entrada_rechazada');
  }
  const key = String(b.idempotency_key || '');
  if (!key || key.length > 200) fail('entrada_rechazada');
  const [prev] = await sql`select * from app.etiq_jobs where requested_by=${actor} and idempotency_key=${key}`;
  if (prev) return { duplicate: true, job: prev };
  for (const k of ['sku', 'nombre', 'ov', 'labels', 'order_number']) {
    if (k in (b || {})) fail('entrada_rechazada');
  }
  const suelto = !!(b.product_id || b.line_id || b.qty_etiqueta != null || b.copies != null);
  if (!suelto) {
    const id = String(b.ov_id || '');
    if (!uuidOk(id)) fail('ov_ajena');
    const [ov] = await sql`select id, order_number from app.sales_orders where id=${id}::uuid`;
    if (!ov) fail('ov_ajena');
    const rows = await sql`select p.sku, coalesce(p.name, l.description, '') nombre, l.quantity::float qty from app.sales_order_lines l where l.sales_order_id=${ov.id}::uuid`;
    if (!rows.length) fail('nada_que_imprimir');
    const labels = rows.map((r) => etiqueta(String(r.nombre || ''), String(r.sku || ''), r.qty, ov.order_number));
    const [job] = await sql`insert into app.etiq_jobs values (${ov.id}, ${ov.order_number}, ${actor}, ${key}, ${labels})`;
    return { duplicate: false, job };
  }
  const copies = entero(b.copies == null ? 1 : b.copies, 1, 20);
  if (b.product_id && !b.ov_id && !b.line_id) {
    if (!uuidOk(b.product_id)) fail('entrada_rechazada');
    const qty = entero(b.qty_etiqueta == null ? 1 : b.qty_etiqueta, 1, 999);
    const [p] = await sql`select sku, coalesce(name,'') nombre from app.products where id=${String(b.product_id)}::uuid`;
    if (!p || !p.sku) fail('nada_que_imprimir');
    const labels = [];
    const one = etiqueta(String(p.nombre || ''), String(p.sku), qty, '');
    for (let i = 0; i < copies; i++) labels.push(JSON.parse(JSON.stringify(one)));
    const [job] = await sql`insert into app.etiq_jobs values (${null}, ${''}, ${actor}, ${key}, ${labels})`;
    return { duplicate: false, job };
  }
  if (!uuidOk(b.ov_id) || !uuidOk(b.line_id) || b.product_id) fail('entrada_rechazada');
  const [row] = await sql`select o.id from app.sales_order_lines l where l.id=${String(b.line_id)}::uuid and o.id=${String(b.ov_id)}::uuid`;
  if (!row) fail('ov_ajena');
  const qty = entero(b.qty_etiqueta == null ? Math.max(1, Math.round(Number(row.q) || 1)) : b.qty_etiqueta, 1, 999);
  const labels = [];
  const one = etiqueta(String(row.nombre || ''), String(row.sku), qty, String(row.order_number || ''));
  for (let i = 0; i < copies; i++) labels.push(JSON.parse(JSON.stringify(one)));
  const [job] = await sql`insert into app.etiq_jobs values (${row.ov_id}, ${row.order_number}, ${actor}, ${key}, ${labels})`;
  return { duplicate: false, job };
}

function check(cond, msg) { if (!cond) throw new Error(msg); }

const db = {
  products: {
    [PID]: { sku: 'PRUEBA-SKU', nombre: 'PRODUCTO DE PRUEBA', item_type: 'stockedProduct', is_active: true }
  },
  orders: { [OVID]: { id: OVID, order_number: 'PRUEBA-SO-9', cancelled: false } },
  lines: [
    { id: L1, ov_id: OVID, sku: 'PRUEBA-A', nombre: 'Pieza A', q: 2, line_num: 1, item_type: 'stockedProduct', discarded: false, order_number: 'PRUEBA-SO-9' },
    { id: L2, ov_id: OVID, sku: 'PRUEBA-A', nombre: 'Pieza A repetida', q: 5, line_num: 2, item_type: 'stockedProduct', discarded: false, order_number: 'PRUEBA-SO-9' },
    { id: L3, ov_id: OVID, sku: 'PRUEBA-B', nombre: 'Pieza B', q: 1, line_num: 3, item_type: 'stockedProduct', discarded: false, order_number: 'PRUEBA-SO-9' }
  ]
};

const browser = {
  t: 'SESION',
  action: 'ventas',
  op: 'etiq_enqueue',
  copies: 1,
  qty_etiqueta: 1,
  idempotency_key: 'uno:' + PID + '::1:1:9',
  product_id: PID,
  actor: 'OTRO'
};
const body = gateway(browser, 'USUARIO_SESION');
check(body.actor === 'USUARIO_SESION', 'el gateway no reemplazó actor');
check(!('user' in body) && !('pin' in body), 'credencial de pantalla');
check(!('sku' in body), 'sku');
const buggy = ['sku', 'nombre', 'ov', 'labels', 'order_number', 'actor'].some((k) => k in body);
check(buggy, 'el 411 no habría rechazado este cuerpo');

const m1 = mockSql(db);
const a1 = await enqueue(body, m1.sql, body.actor);
check(a1.duplicate === false, 'primero');
check(a1.job.ov_id === null, 'ov nula');
check(a1.job.requested_by === 'USUARIO_SESION', 'identidad');
check(a1.job.labels.length === 1, 'una');
check(a1.job.labels[0].fields.ov === '', 'sin SO inventada');
check(a1.job.labels[0].fields.sku === 'PRUEBA-SKU', 'sku de la base');
check(a1.job.labels[0].fields.qty === '1', 'cantidad');
const a2 = await enqueue(body, m1.sql, body.actor);
check(a2.duplicate === true && m1.jobs.length === 1, 'doble tap');

const malo = gateway(Object.assign({}, browser, { sku: 'FALSO', idempotency_key: 'otro' }), 'USUARIO_SESION');
let rejected = '';
try { await enqueue(malo, m1.sql, malo.actor); } catch (e) { rejected = e.message; }
check(rejected === 'entrada_rechazada' && m1.jobs.length === 1, 'sku falso');

const muchas = gateway(Object.assign({}, browser, { copies: 21, idempotency_key: 'mas' }), 'USUARIO_SESION');
rejected = '';
try { await enqueue(muchas, m1.sql, muchas.actor); } catch (e) { rejected = e.message; }
check(rejected === 'entrada_rechazada', 'copies');

const m2 = mockSql(db);
const toda = gateway({
  action: 'ventas', op: 'etiq_enqueue', user: 'USUARIO_SESION', pin: 'x',
  ov_id: OVID, idempotency_key: 'all:' + OVID + ':1'
}, 'USUARIO_SESION');
const all = await enqueue(toda, m2.sql, toda.actor);
check(all.job.labels.length === 3, 'tres lineas');
check(all.job.labels.map((l) => l.fields.sku + '×' + l.fields.qty).join(',') === 'PRUEBA-A×2,PRUEBA-A×5,PRUEBA-B×1', 'duplicada se conserva');
check(all.job.labels.every((l) => l.fields.ov === 'PRUEBA-SO-9'), 'SO completa');
check(m2.jobs.length === 1, 'un trabajo');

const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.getProfile = function () { return { rol: 'usuario', modulos: ['inventario', '~prep.e.etiq=1'] }; };
const posts = [];
sandbox.MCpost = function (p) { posts.push(JSON.parse(JSON.stringify(p))); return Promise.resolve({ ok: false, error: 'entrada_rechazada' }); };
vm.runInNewContext(panelSrc, sandbox);
const cur = { orden: { id: OVID, is_quote: false, is_cancelled: false, order_number: 'PRUEBA-SO-9' } };
sandbox.document = { getElementById: function () { return { textContent: '' }; } };
sandbox.MCEtiq.toda(cur);
sandbox.MCEtiq.toda(cur);
await new Promise((r) => setTimeout(r, 20));
check(posts.length === 1, 'doble tap ui');
check(posts[0].op === 'etiq_enqueue' && posts[0].ov_id === OVID && !posts[0].line_id && !posts[0].sku && !posts[0].actor, 'print toda');
const fit = `<!doctype html><meta charset="utf-8"><title>fit</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,sans-serif}
.row{display:flex;flex-wrap:wrap;gap:8px;padding:12px}
.chip{background:#12202d;color:#dce6f0;border:1px solid #2a3d52;border-radius:12px;padding:10px 12px;white-space:nowrap}
.etiq-remote{flex:1 1 100%;text-align:center}
.menu{position:relative;margin:12px}
#vt-print{position:absolute;right:0;min-width:240px;max-width:calc(100vw - 24px);background:#13202e;border:1px solid #26405c;border-radius:10px;padding:4px}
#vt-print .chip{display:block;white-space:normal;margin:2px 0}
#result{position:absolute;left:-9999px}
</style>
<div class="row">
<button class="chip">PDF o DYMO de este equipo</button>
<button class="chip etiq-remote" id="uno">Imprimir etiqueta remota</button>
</div>
<div class="menu"><button class="chip" id="print">Print</button>
<div id="vt-print"><div class="chip">Labels (DYMO 19×51 mm)</div><div class="chip" id="todas">Imprimir etiquetas remotas</div></div>
</div>
<div id="result"></div>
<script>
var bad=[];
function fitBtn(el){
  var r=el.getBoundingClientRect();
  if(r.left<0||r.right>document.documentElement.clientWidth+1) bad.push('fuera '+el.id);
  if(el.scrollWidth>el.clientWidth+1) bad.push('recorte '+el.id+' '+el.scrollWidth+'>'+el.clientWidth);
  if(el.textContent.indexOf('Imprimir etiqueta')!==0) bad.push('texto '+el.id);
}
fitBtn(document.getElementById('uno'));
fitBtn(document.getElementById('todas'));
document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
</script>`;
const dir = '/tmp/etiq-fit';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'fit.html'), fit);
const chrome = '/usr/local/bin/google-chrome';
const dump = spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-fit', '--timeout=4000', '--window-size=390,844', '--virtual-time-budget=800', '--dump-dom', 'file://' + join(dir, 'fit.html')], { encoding: 'utf8' });
const mark = ((dump.stdout || '').match(/<div id="result">([^<]*)</) || [])[1] || '';
if (mark !== 'OK') throw new Error('390 ' + mark);
spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-fit-s', '--timeout=4000', '--window-size=390,844', '--screenshot=/opt/cursor/artifacts/etiq-boton-390.png', 'file://' + join(dir, 'fit.html')], { encoding: 'utf8' });
console.log('etiq-contrato OK');
