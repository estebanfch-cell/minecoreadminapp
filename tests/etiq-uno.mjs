/**
 * Botón directo, estado que sale de la cola y contador de envíos aceptados.
 * No encola ni imprime de verdad.
 *   node tests/etiq-uno.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const panel = readFileSync(join(root, 'etiq/panel.js'), 'utf8');
if (!html.includes("['etiq','Imprimir etiquetas remotas']")) throw new Error('falta Print');
if (!html.includes('MCEtiq.directo(this,')) throw new Error('el producto no envía directo');
if (html.includes('MCEtiq.ov(cur)')) throw new Error('la OV sigue abriendo el formulario');
if (panel.includes('Una etiqueta de')) throw new Error('sigue el panel');
if (!panel.includes('Una por unidad')) throw new Error('falta el modal de tickets');
if (!html.includes('MCEtiq.elegir(cur)')) throw new Error('Print no abre el modal');
if (html.includes("openMod('voc')") && html.slice(html.indexOf('MCEtiq.directo'), html.indexOf('MCEtiq.directo') + 80).includes('voc')) throw new Error('OC');

function child() {
  const node = { className: '', _t: '', _h: '' };
  Object.defineProperty(node, 'textContent', {
    get() { return this._t; },
    set(v) { this._t = String(v); this._h = String(v); }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._h; },
    set(v) { this._h = String(v); this._t = String(v).replace(/<[^>]+>/g, ''); }
  });
  node.getAttribute = function () { return ''; };
  node.setAttribute = function () {};
  return node;
}
function host() {
  const node = {
    innerHTML: '',
    count: child(),
    st: child(),
    querySelector(sel) {
      if (sel === '.etiq-count') return this.count;
      if (sel === '.etiq-st') return this.st;
      return null;
    }
  };
  return node;
}
function boton(texto) {
  return {
    disabled: false,
    textContent: texto,
    innerHTML: '',
    attrs: {},
    getAttribute(k) { return this.attrs[k] || ''; },
    setAttribute(k, v) { this.attrs[k] = v; }
  };
}

const id = '11111111-1111-4111-8111-111111111111';
const ovid = '22222222-2222-4222-8222-222222222222';
const job = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function cargar(posts, responder, perfil) {
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.getProfile = perfil || function () { return { rol: 'usuario', modulos: ['inventario', '~prep.e.etiq=1'] }; };
  const prod = host();
  const toda = child();
  const ovn = child();
  sandbox.document = {
    getElementById(i) {
      if (i === 'etiq-prod') return prod;
      if (i === 'etiq-toda') return toda;
      if (i === 'etiq-ov-n') return ovn;
      if (i === 'etiq-css') return {};
      return null;
    },
    createElement() { return { id: '', textContent: '' }; },
    head: { appendChild() {} }
  };
  vm.runInNewContext(panel, sandbox);
  sandbox.MCEtiq._paso = 20;
  sandbox.MCpost = function (p) {
    const copy = JSON.parse(JSON.stringify(p));
    posts.push(copy);
    return Promise.resolve(responder(copy, posts));
  };
  return { ui: sandbox.MCEtiq, prod, toda, ovn };
}

const posts = [];
let statusN = 0;
const visto = {};
const uiBox = cargar(posts, function (p) {
  if (p.op === 'etiq_enqueue') {
    if (visto[p.idempotency_key]) {
      return { ok: true, etiq: 1, physically_printed: false, duplicate: true, bridge: 'conectado', printer: 'lista', job: { id: job, status: 'accepted_by_cups', physically_printed: false } };
    }
    visto[p.idempotency_key] = 1;
    return { ok: true, etiq: 1, physically_printed: false, bridge: 'desconectado', printer: 'desconocida', job: { id: job, status: 'queued', physically_printed: false } };
  }
  if (p.op === 'etiq_status') {
    statusN += 1;
    const st = statusN < 2 ? 'queued' : 'accepted_by_cups';
    return { ok: true, etiq: 1, physically_printed: false, bridge: 'conectado', printer: 'lista', job: { id: job, status: st, physically_printed: false } };
  }
  if (p.op === 'etiq_cuenta') {
    return { ok: true, etiq: 1, physically_printed: false, cuenta: 'enviadas_a_impresora', enviadas: 1, etiquetas: 2 };
  }
  return { ok: false, error: 'Operación no válida' };
});
const btn = boton('Imprimir etiqueta remota');
uiBox.ui.directo(btn, id);
uiBox.ui.directo(btn, id);
if (!btn.disabled) throw new Error('el botón siguió activo');
if (posts.filter((p) => p.op === 'etiq_enqueue').length !== 1) throw new Error('doble envío');
await new Promise((r) => setTimeout(r, 250));
const envios = posts.filter((p) => p.op === 'etiq_enqueue');
const cuerpo = envios[0];
if (cuerpo.copies !== 1 || cuerpo.qty_etiqueta !== 1 || cuerpo.product_id !== id) throw new Error('cantidad');
if (cuerpo.sku || cuerpo.nombre || cuerpo.ov || cuerpo.labels || cuerpo.actor || cuerpo.line_id) throw new Error('el cliente mandó datos de la etiqueta');
if (posts.filter((p) => p.op === 'etiq_status').length < 2) throw new Error('no siguió el trabajo');
if (btn.disabled) throw new Error('quedó trabado');
if (uiBox.prod.st.textContent !== 'Enviada a impresora') throw new Error('estado ' + uiBox.prod.st.textContent);
if (/en cola|trabajo en cola|papel|físic|CUPS aceptó|49f0e0d5/i.test(uiBox.prod.st.textContent)) throw new Error('texto de más');
if (uiBox.prod.count.textContent !== 'Enviadas a impresora 1') throw new Error('contador ' + uiBox.prod.count.textContent);
if (uiBox.prod.st.innerHTML && uiBox.prod.st.innerHTML.includes('etiq-spin')) throw new Error('el spinner quedó');
const antes = envios.length;
uiBox.ui.directo(btn, id);
await new Promise((r) => setTimeout(r, 40));
const despues = posts.filter((p) => p.op === 'etiq_enqueue');
if (despues.length !== antes + 1) throw new Error('no reutilizó la clave');
if (despues[despues.length - 1].idempotency_key !== cuerpo.idempotency_key) throw new Error('clave nueva');
if (uiBox.prod.count.textContent !== 'Enviadas a impresora 1') throw new Error('sumó el clic');

const malos = [];
const malo = cargar(malos, function () { return { ok: false, error: 'entrada_rechazada' }; });
const btn2 = boton('Imprimir etiqueta remota');
malo.ui.directo(btn2, id);
await new Promise((r) => setTimeout(r, 30));
if (malo.prod.st.textContent !== 'Error') throw new Error('error ' + malo.prod.st.textContent);
if (malo.prod.count.textContent) throw new Error('contador ficticio');
if (malos.some((p) => p.op === 'etiq_cuenta')) throw new Error('contó un rechazo');

const vacio = [];
const sin = cargar(vacio, function () { return { ok: false, error: 'Operación no válida' }; });
sin.ui.ver(id);
await new Promise((r) => setTimeout(r, 20));
if (sin.prod.count.textContent) throw new Error('mostró cero sin operación');

const recarga = [];
const otra = cargar(recarga, function (p) {
  if (p.op === 'etiq_cuenta' && p.product_id === id && !p.sku) return { ok: true, etiq: 1, physically_printed: false, cuenta: 'enviadas_a_impresora', enviadas: 2, etiquetas: 3 };
  return { ok: false, error: 'Operación no válida' };
});
otra.ui.ver(id);
await new Promise((r) => setTimeout(r, 20));
if (otra.prod.count.textContent !== 'Enviadas a impresora 2') throw new Error('recarga ' + otra.prod.count.textContent);
if (recarga.some((p) => p.op === 'etiq_enqueue')) throw new Error('la recarga encoló');

const negados = [];
const boxNo = cargar(negados, function () { return { ok: true }; }, function () { return { rol: 'usuario', modulos: ['inventario'] }; });
boxNo.ui.directo(boton('Imprimir etiqueta remota'), id);
await new Promise((r) => setTimeout(r, 20));
if (negados.some((p) => p.op === 'etiq_enqueue')) throw new Error('sin permiso envió');

const orden = [];
let nOrden = 0;
const ov = cargar(orden, function (p) {
  if (p.op === 'etiq_enqueue') return { ok: true, etiq: 1, physically_printed: false, bridge: 'desconectado', job: { id: job, status: 'queued', physically_printed: false } };
  if (p.op === 'etiq_status') {
    nOrden += 1;
    return { ok: true, etiq: 1, physically_printed: false, bridge: 'conectado', printer: 'lista', job: { id: job, status: nOrden < 2 ? 'claimed' : 'accepted_by_cups', physically_printed: false } };
  }
  if (p.op === 'etiq_cuenta') return { ok: true, etiq: 1, physically_printed: false, cuenta: 'enviadas_a_impresora', enviadas: 1, etiquetas: 2 };
  return { ok: false };
});
const cur = { orden: { id: ovid, is_quote: false, is_cancelled: false } };
ov.ui.toda(cur);
ov.ui.toda(cur);
await new Promise((r) => setTimeout(r, 250));
const all = orden.filter((p) => p.op === 'etiq_enqueue');
if (all.length !== 1 || all[0].ov_id !== ovid || all[0].line_id || all[0].sku) throw new Error('orden');
if (ov.toda.textContent !== 'Enviada a impresora') throw new Error('orden estado ' + ov.toda.textContent);
if (ov.ovn.textContent !== 'Enviadas a impresora 1') throw new Error('orden contador');

function ledger(jobs, filtro) {
  const acc = jobs.filter((j) => j.status === 'accepted_by_cups');
  if (filtro.ov_id) {
    const rows = acc.filter((j) => j.ov_id === filtro.ov_id);
    return { enviadas: rows.length, etiquetas: rows.reduce((n, j) => n + j.labels.length, 0) };
  }
  const rows = acc.filter((j) => j.labels.some((l) => l.fields.sku === filtro.sku));
  return {
    enviadas: rows.length,
    etiquetas: rows.reduce((n, j) => n + j.labels.filter((l) => l.fields.sku === filtro.sku).length, 0)
  };
}
const A = 'MCOR-A';
const B = 'MCOR-B';
const lab = (sku, qty) => ({ fields: { sku, qty: String(qty) } });
const jobs = [
  { status: 'accepted_by_cups', ov_id: ovid, labels: [lab(A, 3), lab(B, 3)] },
  { status: 'queued', ov_id: ovid, labels: [lab(A, 3)] },
  { status: 'ambiguous', ov_id: ovid, labels: [lab(A, 3)] },
  { status: 'send_error', ov_id: ovid, labels: [lab(A, 3)] },
  { status: 'accepted_by_cups', ov_id: ovid, labels: [lab(A, 3)] }
];
const ovLedger = ledger(jobs, { ov_id: ovid });
const prodLedger = ledger(jobs, { sku: A });
if (ovLedger.enviadas !== 2 || ovLedger.etiquetas !== 3) throw new Error('ledger ov ' + JSON.stringify(ovLedger));
if (prodLedger.enviadas !== 2 || prodLedger.etiquetas !== 2) throw new Error('ledger prod ' + JSON.stringify(prodLedger));
if (ledger([{ status: 'accepted_by_cups', ov_id: ovid, labels: [lab(A, 20)] }], { ov_id: ovid }).etiquetas !== 1) throw new Error('sumó la cantidad de la etiqueta');

const page = `<!doctype html><meta charset="utf-8"><title>uno</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,sans-serif}
.pf-act{display:flex;gap:6px;flex-wrap:wrap;padding:12px}
.chip{background:#12202d;color:#dce6f0;border:1px solid #2a3d52;border-radius:12px;padding:10px 12px}
.etiq-remote{flex:1 1 100%;max-width:100%;text-align:center;white-space:nowrap}
.etiq-count{font-size:12px;color:#8fa3b8;margin:4px 12px}
.etiq-st{margin:0 12px;font-size:13px}
@media(max-width:600px){.pf-act{flex-wrap:nowrap}.pf-act>button:not(:first-child){display:none}.pf-act.open>button:not(:first-child){display:block;width:100%;text-align:left}.pf-act.open{flex-wrap:wrap}}
#result{position:absolute;left:-9999px}
</style>
<div class="pf-act open">
<button class="chip">← Inventario</button>
<button class="chip">PDF o DYMO de este equipo</button>
<button class="chip etiq-remote" id="uno">Imprimir etiqueta remota</button>
</div>
<div class="etiq-count" id="n">Enviadas a impresora 1</div>
<div class="etiq-st" id="st">Enviada a impresora</div>
<div id="result"></div>
<script>
var bad=[];
var uno=document.getElementById('uno');
var r=uno.getBoundingClientRect();
if(r.right>document.documentElement.clientWidth+1||r.left<0) bad.push('fuera');
if(uno.scrollWidth>uno.clientWidth+1) bad.push('recorte '+uno.scrollWidth+'>'+uno.clientWidth);
if(uno.textContent!=='Imprimir etiqueta remota') bad.push('texto');
var t=document.body.innerText;
if(t.indexOf('Una etiqueta')>=0||t.indexOf('Trabajo en cola')>=0||t.indexOf('AirPrint')>=0) bad.push('panel');
if(t.indexOf('Enviada a impresora')<0||t.indexOf('Enviadas a impresora 1')<0) bad.push('estado');
document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
</script>`;
const dir = '/tmp/etiq-uno';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'uno.html'), page);
const chrome = '/usr/local/bin/google-chrome';
const dump = spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-uno-390', '--timeout=4000', '--window-size=390,844', '--virtual-time-budget=800', '--dump-dom', 'file://' + join(dir, 'uno.html')], { encoding: 'utf8' });
const mark = ((dump.stdout || '').match(/<div id="result">([^<]*)</) || [])[1] || '';
if (mark !== 'OK') throw new Error('390 ' + mark + ' ' + (dump.stderr || '').slice(0, 200));
spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-uno-390s', '--timeout=4000', '--window-size=390,844', '--screenshot=/opt/cursor/artifacts/etiq-directo-390.png', 'file://' + join(dir, 'uno.html')], { encoding: 'utf8' });
console.log('etiq-uno OK');
