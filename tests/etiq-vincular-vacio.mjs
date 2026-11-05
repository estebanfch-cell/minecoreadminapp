/**
 * Cabecera de Preparar orden con 0 OV. Datos de prueba. No abre el portal ni crea órdenes.
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
const lista = html.slice(html.indexOf('function pqLista()'), html.indexOf('function renderPq()'));
if (!/etiqCab\(\)[\s\S]*id="pq-res"/.test(pq)) throw new Error('Preparar no monta el código en la cabecera');
if (lista.includes('Código para el iMac')) throw new Error('el botón depende de una tarjeta');
if (!html.includes("function etiqCab()")) throw new Error('falta etiqCab');

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>vincular</title>
<style>
*{box-sizing:border-box}html,body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
h1{font-size:22px;margin:14px 12px 8px}
.cbz-search{background:#12202d;border:1px solid #E8FF00;color:#fff;border-radius:20px;padding:10px 12px;width:100%}
.chip{background:#E8FF00;color:#1b1d4a;border:0;border-radius:20px;padding:8px 12px;font-weight:700}
.cbz-card-row{display:flex;gap:8px;align-items:center;margin:0 12px 10px;flex-wrap:wrap}
.cbz-muted{color:#8fa3b8;font-size:13px}
.cbz-card{background:#12202d;border:1px solid #1c2a3a;border-radius:12px;margin:0 12px;padding:20px;text-align:center;color:#8fa3b8}
.cbz-btn{background:#1e4976;color:#fff;border:0;border-radius:8px;padding:10px 12px;font-weight:700}
#result{position:absolute;left:-9999px;font-size:12px}
</style>
<h1>PREPARAR ORDEN</h1>
<div class="cbz-card-row"><input class="cbz-search" value="Buscar OV, cliente o producto…"><button class="chip" type="button">Pendientes 1</button><span class="cbz-muted">0 OV listas</span></div>
<div id="cab"></div>
<div class="cbz-card" id="vacio">No hay OV con todo el stock listo para preparar. Las que tienen faltantes están en «Pendientes».</div>
<div id="result"></div>
<script>${panel}</script>
<script>
var modo=location.hash.slice(1)||'con';
getProfile=function(){
  if(modo==='sin') return {nombre:'USUARIO_PRUEBA',rol:'usuario',modulos:['inventario']};
  if(modo==='admin') return {nombre:'USUARIO_PRUEBA',rol:'admin',modulos:['~prep.e.etiq=1']};
  return {nombre:'USUARIO_PRUEBA',rol:'usuario',modulos:['inventario','~prep.e.etiq=1']};
};
MCpost=function(p){
  window.__post=p;
  if(modo==='gw') return Promise.resolve({ok:false,error:'Operación no válida'});
  if(modo==='ses') return Promise.resolve(null);
  if(modo==='ok') return Promise.resolve({ok:true,etiq:1,physically_printed:false,code:'PRUEBA23ABCD'});
  return Promise.resolve({ok:false,error:'sesión'});
};
document.getElementById('cab').innerHTML=MCEtiq.vincular();
function place(){
  var btn=document.querySelector('.etiq-vinc button');
  var vac=document.getElementById('vacio').getBoundingClientRect();
  var bad=[];
  if(modo==='sin'){
    if(btn) bad.push('boton sin permiso');
    if(document.body.innerText.indexOf('Código para el iMac')>=0) bad.push('texto sin permiso');
  } else {
    if(!btn) bad.push('falta boton');
    else {
      var r=btn.getBoundingClientRect();
      if(r.width<40||r.height<30) bad.push('boton invisible');
      if(r.top>=vac.top) bad.push('boton debajo del vacio');
      if(r.bottom>vac.top+1) bad.push('pisa el vacio');
    }
    if(document.querySelector('.pq-o')) bad.push('hay tarjeta de OV');
  }
  document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
}
if(modo==='gw'||modo==='ses'||modo==='ok') document.getElementById('result').textContent='PEND';
else place();
if(modo==='gw'||modo==='ses'||modo==='ok'){
  document.querySelector('.etiq-vinc button').click();
  setTimeout(function(){
    var t=document.body.innerText;
    var bad=[];
    if(modo==='ok'){
      if(t.indexOf('PRUEBA23ABCD')<0) bad.push('no mostro codigo');
    } else {
      if(/PRUEBA23ABCD|vinculado|ya está impreso|impresa con éxito/i.test(t)) bad.push('falsa confirmacion');
      if(t.indexOf('No se obtuvo el código')<0) bad.push('sin aviso '+t.slice(0,180));
    }
    if(window.__post.op!=='etiq_pair_begin'||window.__post.actor) bad.push('post');
    document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
  },30);
}
</script>`;

const dir = '/tmp/etiq-vinc';
mkdirSync(dir, { recursive: true });
const file = join(dir, 'vacio.html');
writeFileSync(file, page);
const chrome = '/usr/local/bin/google-chrome';
function run(w, h, hash, png) {
  const args = ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-vinc-' + Math.random().toString(16).slice(2), '--timeout=4000', '--window-size=' + w + ',' + h, '--virtual-time-budget=2000', '--dump-dom', 'file://' + file + '#' + hash];
  const dump = spawnSync('timeout', args, { encoding: 'utf8' });
  const dom = dump.stdout || '';
  const mark = (dom.match(/<div id="result">([^<]*)</) || [])[1] || '';
  if (mark !== 'OK') {
    console.error(dom.slice(-800));
    throw new Error(hash + ' ' + w + ' ' + mark);
  }
  if (png) {
    spawnSync('timeout', ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-vinc-' + Math.random().toString(16).slice(2), '--timeout=4000', '--window-size=' + w + ',' + h, '--screenshot=' + png, 'file://' + file + '#' + hash], { encoding: 'utf8' });
  }
  console.log(hash, w, 'OK');
}
run(390, 844, 'con', '/opt/cursor/artifacts/etiq-vincular-390.png');
run(1280, 800, 'con', '/opt/cursor/artifacts/etiq-vincular-1280.png');
run(390, 844, 'sin', '');
run(390, 844, 'admin', '');
run(390, 844, 'gw', '');
run(390, 844, 'ses', '');
run(1280, 800, 'ok', '');
console.log('etiq-vincular-vacio OK');
