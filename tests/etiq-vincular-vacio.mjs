/**
 * Preparar orden no muestra el código. Impresión, en el engranaje, sí tiene el botón
 * y no muestra un código hasta pedirlo. Datos de prueba. No abre el portal.
 *   node tests/etiq-vincular-vacio.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const panel = readFileSync(join(root, 'etiq/panel.js'), 'utf8');
const pq = html.slice(html.indexOf('function renderPq()'), html.indexOf('function pqAbrir'));
if (pq.includes('etiqCab') || pq.includes('Código para el iMac')) throw new Error('Preparar sigue con el código');
if (!html.includes("m==='vetiq'")) throw new Error('falta la ruta Impresión');
const gear = html.slice(html.indexOf("{k:'admin',ico:'gear'"), html.indexOf("{k:'admin',ico:'gear'") + 1600);
if (!gear.includes("Configuración','cfg',A")) throw new Error('Configuración dejó de ser solo admin');
if (!gear.includes("~prep.e.etiq=1")) throw new Error('Impresión no está acotada al permiso');

const page = `<!doctype html><meta charset="utf-8"><title>imp</title>
<style>
*{box-sizing:border-box}html,body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
h1{font-size:22px;margin:14px 12px 8px}.gear{margin:0 12px 8px;color:#c43d3d;font-weight:800}
.cbz-search{background:#12202d;border:1px solid #E8FF00;color:#fff;border-radius:20px;padding:10px 12px;width:100%}
.chip{background:#E8FF00;color:#1b1d4a;border:0;border-radius:20px;padding:8px 12px;font-weight:700}
.cbz-card-row{display:flex;gap:8px;align-items:center;margin:0 12px 10px;flex-wrap:wrap}
.cbz-muted{color:#8fa3b8;font-size:13px}
.cbz-card{background:#12202d;border:1px solid #1c2a3a;border-radius:12px;margin:8px 12px;padding:12px}
.cbz-btn{background:#1e4976;color:#fff;border:0;border-radius:8px;padding:10px 12px;font-weight:700}
#result{position:absolute;left:-9999px}
</style>
<h1 id="tit">PREPARAR ORDEN</h1>
<div id="app"></div>
<div id="result"></div>
<script>${panel}</script>
<script>
var modo=location.hash.slice(1)||'vacio';
getProfile=function(){
  if(modo==='sin'||modo==='ovsin') return {nombre:'USUARIO_PRUEBA',rol:'usuario',modulos:['inventario']};
  if(modo==='oswal') return {nombre:'USUARIO_PRUEBA',rol:'usuario',modulos:['inventario','picking','~prep.e.etiq=1']};
  return {nombre:'USUARIO_PRUEBA',rol:'admin',modulos:['~prep.e.etiq=1']};
};
MCpost=function(){return Promise.resolve({ok:false,error:'Operación no válida'});};
var app=document.getElementById('app');
if(modo==='imp'||modo==='sin'||modo==='oswal'){
  document.getElementById('tit').textContent='IMPRESIÓN';
  app.innerHTML='<div class="gear">Engranaje · Impresión</div>'+MCEtiq.impresion();
} else if(modo==='ov'||modo==='ovsin'){
  app.innerHTML='<div class="cbz-card-row"><input class="cbz-search" value="Buscar OV, cliente o producto…"><span class="cbz-muted">1 OV listas</span></div>'+
    '<div class="cbz-card"><b>PRUEBA-SO-0001</b><div class="cbz-muted">CLIENTE DE PRUEBA</div></div>'+
    MCEtiq.panel({id:'ov-prueba',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',lineas:[{sku:'PRUEBA-SKU',nombre:'PRODUCTO DE PRUEBA',cantidad:1,item_type:'product'}]},'prep');
} else {
  app.innerHTML='<div class="cbz-card-row"><input class="cbz-search" value="Buscar OV, cliente o producto…"><button class="chip" type="button">Pendientes 1</button><span class="cbz-muted">0 OV listas</span></div>'+
    '<div class="cbz-card" id="vacio">No hay OV con todo el stock listo para preparar. Las que tienen faltantes están en «Pendientes».</div>';
}
function check(){
  var t=document.body.innerText, bad=[];
  if(modo==='vacio'||modo==='sin'||modo==='ovsin'){
    if(t.indexOf('Código para el iMac')>=0) bad.push('boton de codigo');
    if(/[A-Z0-9]{10,}/.test(t.replace(/PRUEBA-SO-0001|PRUEBA-SKU|PRODUCTO DE PRUEBA|CLIENTE DE PRUEBA/g,''))) bad.push('parece un codigo');
  }
  if(modo==='ov'){
    if(t.indexOf('Imprimir etiquetas')<0) bad.push('falta imprimir');
    if(t.indexOf('Código para el iMac')>=0) bad.push('codigo en la orden');
  }
  if(modo==='imp'||modo==='oswal'){
    var b=document.querySelector('.etiq-vinc button');
    if(!b) bad.push('falta boton');
    if(document.querySelector('.etiq-code')) bad.push('codigo visible sin pedirlo');
    if(t.indexOf('bodegas')>=0||t.indexOf('Numeración')>=0||t.indexOf('Usuarios')>=0) bad.push('config general');
  }
  document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
}
check();
</script>`;

const dir = '/tmp/etiq-imp';
mkdirSync(dir, { recursive: true });
const file = join(dir, 'imp.html');
writeFileSync(file, page);
const chrome = '/usr/local/bin/google-chrome';
function run(w, h, hash, png) {
  const base = ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars'];
  const dump = spawnSync('timeout', base.concat(['--user-data-dir=/tmp/chrome-imp-' + Math.random().toString(16).slice(2), '--timeout=4000', '--window-size=' + w + ',' + h, '--virtual-time-budget=1500', '--dump-dom', 'file://' + file + '#' + hash]), { encoding: 'utf8' });
  const mark = ((dump.stdout || '').match(/<div id="result">([^<]*)</) || [])[1] || '';
  if (mark !== 'OK') {
    console.error((dump.stdout || '').slice(-700));
    throw new Error(hash + ' ' + w + ' ' + mark);
  }
  if (png) spawnSync('timeout', base.concat(['--user-data-dir=/tmp/chrome-imp-' + Math.random().toString(16).slice(2), '--timeout=4000', '--window-size=' + w + ',' + h, '--screenshot=' + png, 'file://' + file + '#' + hash]), { encoding: 'utf8' });
  console.log(hash, w, 'OK');
}
run(390, 844, 'vacio', '/opt/cursor/artifacts/etiq-preparar-vacio-390.png');
run(1280, 800, 'vacio', '/opt/cursor/artifacts/etiq-preparar-vacio-1280.png');
run(390, 844, 'ov', '/opt/cursor/artifacts/etiq-preparar-ov-390.png');
run(1280, 800, 'ov', '/opt/cursor/artifacts/etiq-preparar-ov-1280.png');
run(390, 844, 'imp', '/opt/cursor/artifacts/etiq-impresion-390.png');
run(1280, 800, 'imp', '/opt/cursor/artifacts/etiq-impresion-1280.png');
run(390, 844, 'sin', '');
run(390, 844, 'ovsin', '');
run(1280, 800, 'oswal', '');
console.log('etiq-impresion OK');
