/**
 * Una etiqueta desde una OV o un producto. No encola ni crea órdenes.
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
if (!html.includes('MCEtiq.ov(cur)')) throw new Error('la OV no pide una etiqueta');
if (!html.includes('MCEtiq.prod(')) throw new Error('el producto no pide una etiqueta');
if (html.includes("openMod('voc')") && html.slice(html.indexOf('MCEtiq.prod'), html.indexOf('MCEtiq.prod') + 80).includes('voc')) throw new Error('OC');
const det = html.slice(html.indexOf('function renderDetalle()'), html.indexOf('function renderDetalle()') + 200);
if (det.includes('MCEtiq')) throw new Error('lugar');
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(panel, sandbox);
const ui = sandbox.MCEtiq;
const id = '11111111-1111-1111-1111-111111111111';
const line = '22222222-2222-2222-2222-222222222222';
sandbox.getProfile = function () { return { rol: 'usuario', modulos: ['inventario'] }; };
if (ui.ov({ orden: { id, is_quote: false, is_cancelled: false }, lineas: [{ id: line, sku: 'X', nombre: 'N', quantity: 2, item_type: 'product' }] })) throw new Error('sin permiso');
sandbox.getProfile = function () { return { rol: 'usuario', modulos: ['inventario', '~prep.e.etiq=1'] }; };
const ovHtml = ui.ov({ orden: { id, is_quote: false, is_cancelled: false }, lineas: [
  { id: line, sku: 'SKU-REAL', nombre: 'NOMBRE REAL', quantity: 2, item_type: 'product' },
  { id: '33333333-3333-3333-3333-333333333333', sku: 'OTRO', nombre: 'SERV', quantity: 1, item_type: 'service' }
] });
if (!ovHtml.includes('Enviar al iMac') || !ovHtml.includes('SKU-REAL') || ovHtml.includes('SERV')) throw new Error('form ov');
if (ui.ov({ orden: { id, is_quote: true }, lineas: [] })) throw new Error('cotizacion');
const posts = [];
sandbox.MCpost = function (p) { posts.push(p); return Promise.resolve({ ok: true, etiq: 1, physically_printed: false, bridge: 'desconectado', printer: 'desconocida', job: { id: 'job', status: 'queued' } }); };
sandbox.document = {
  getElementById: function () { return null; },
  createElement: function () { return { style: {}, textContent: '' }; }
};
const host = { html: '' };
sandbox.document.getElementById = function (i) { return i === 'etiq-prod' ? host : null; };
Object.defineProperty(host, 'innerHTML', { set: function (v) { host.html = v; }, get: function () { return host.html; } });
ui.prod(id);
if (!host.html.includes('no lleva número de orden') || host.html.includes('SO-')) throw new Error('producto inventa orden');
const box = {
  attrs: {},
  getAttribute: function (k) { return this.attrs[k]; },
  setAttribute: function (k, v) { this.attrs[k] = v; },
  querySelector: function (s) {
    if (s === '.etiq-qty') return { value: '3' };
    if (s === '.etiq-copias') return { value: '1' };
    if (s === '.etiq-out') return this.out;
    if (s === '.etiq-linea') return { value: line };
    return null;
  },
  out: { textContent: '' },
  attrs: { 'data-kind': 'prod', 'data-id': id, 'data-nonce': '9' }
};
box.closest = function () { return box; };
const btn = { closest: function () { return box; } };
ui.enviar(btn);
ui.enviar(btn);
await new Promise(function (r) { setTimeout(r, 20); });
if (posts.length !== 1) throw new Error('doble tap ' + posts.length);
const body = posts[0];
if (body.op !== 'etiq_enqueue' || body.product_id !== id || body.sku || body.nombre || body.ov || body.labels || body.actor) throw new Error('cuerpo');
if (body.copies !== 1 || body.qty_etiqueta !== 3) throw new Error('cantidades');
if (!/en cola/i.test(box.out.textContent) || /haya salido|impresa con éxito|No se obtuvo el código/i.test(box.out.textContent)) throw new Error('estado ' + box.out.textContent);
box.querySelector = function (s) {
  if (s === '.etiq-qty') return { value: '0' };
  if (s === '.etiq-copias') return { value: '1' };
  if (s === '.etiq-out') return box.out;
  return null;
};
ui.enviar(btn);
if (posts.length !== 1) throw new Error('acepto cero');
if (!/no se aceptan/i.test(box.out.textContent)) throw new Error('cero');

const page = `<!doctype html><meta charset="utf-8"><title>uno</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,sans-serif;padding:12px}
.cbz-btn{background:#1e4976;color:#fff;border:0;border-radius:8px;padding:10px 12px;font-weight:700}
#result{position:absolute;left:-9999px}</style>
<div id="app"></div><div id="result"></div>
<script>${panel}</script>
<script>
getProfile=function(){return {rol:'usuario',modulos:['inventario','~prep.e.etiq=1']};};
document.getElementById('app').innerHTML=MCEtiq.ov({orden:{id:'${id}',is_quote:false,is_cancelled:false},lineas:[{id:'${line}',sku:'SKU-REAL',nombre:'NOMBRE REAL',quantity:2,item_type:'product'}]});
var t=document.body.innerText, bad=[];
if(t.indexOf('Enviar al iMac')<0) bad.push('boton');
if(t.indexOf('AirPrint')<0) bad.push('aviso');
if(/[A-Z]{2,}-SO-/.test(t)) bad.push('orden inventada');
document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
</script>`;
const dir = '/tmp/etiq-uno';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'uno.html'), page);
const chrome = '/usr/local/bin/google-chrome';
for (const [w, h, name] of [[390, 844, 'etiq-una-390.png'], [1280, 800, 'etiq-una-1280.png']]) {
  const dump = spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-uno-' + w, '--timeout=4000', '--window-size=' + w + ',' + h, '--virtual-time-budget=800', '--dump-dom', 'file://' + join(dir, 'uno.html')], { encoding: 'utf8' });
  const mark = ((dump.stdout || '').match(/<div id="result">([^<]*)</) || [])[1] || '';
  if (mark !== 'OK') throw new Error(name + ' ' + mark);
  spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-uno-s' + w, '--timeout=4000', '--window-size=' + w + ',' + h, '--screenshot=/opt/cursor/artifacts/' + name, 'file://' + join(dir, 'uno.html')], { encoding: 'utf8' });
  console.log(name, 'OK');
}
console.log('etiq-uno OK');
