/**
 * Recepción de packing con error: se ve en rojo, el admin puede reintentarla
 * y, al confirmar el servidor, desaparece. 390 px y escritorio.
 *   node tests/recibo-error.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='622'")) throw new Error('build');
if (!sw.includes("var SWV='b622'")) throw new Error('sw');
if (!html.includes('Reintentar recepción fallida')) throw new Error('botón');
if (!html.includes('costeo_recibo_reintentar')) throw new Error('op');
const fmt = html.slice(html.indexOf('/* MCCOSTEO-FMT-BEGIN */'), html.indexOf('/* MCCOSTEO-FMT-END */') + '/* MCCOSTEO-FMT-END */'.length);
const costeo = html.slice(html.indexOf('var MCCosteo=(function(){'), html.indexOf('/* ---------- b357: Configuración'));

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>rpk</title>
<div id="maes-screen"></div><div id="result"></div>
<script>
window.__W=${w};
function getProfile(){return {rol:window.__rol||'admin'};}
function mcEsAdmin(){return getProfile().rol==='admin';}
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function MCcan(){return false;}
window.MCroute={set:function(){}};
window.confirm=function(){return true;};
var gets=0, ops=[];
function detalle(err){return {ok:true,markup:0.25,costeo:{id:'c1',codigo:'MCOR-02.3.5.13',estado:'recibido',isd_rate:0.05,comision:0,isd_base:'cif',iva_rate:0.15},totales:{M:1,Q:1,U:1,AE:1,V:1,AF:1,AQ:1},lineas:[{id:'L1',sku:'MCOR000522',descripcion:'TUBE',po:'MCOR-PO-000386',qty_factura:30,qty_pre:30,qty_contada:30,qty_recibida:30,estado:'ok'}],discrepancias:[],docs:[],historial:[],recibos_error:err?[{id:45,sku:'MCOR000522',po:'MCOR-PO-000386',qty:30,sublocation:'10-B-2',error:'po_receive: Recibes más de lo pedido (pedido 0)'}]:[]};}
function MCpost(b){ops.push(b.op);if(b.op==='costeo_get')return Promise.resolve(detalle(gets++===0));if(b.op==='costeo_recibo_reintentar'){if(b.recibo_id!==45)return Promise.resolve({ok:false,error:'recibo'});return Promise.resolve({ok:true,reintentado:true});}return Promise.resolve({ok:true});}
${fmt}
${costeo}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCCosteo.init('c1');
setTimeout(function(){
  MCCosteo.tabG('recep');
  var t=document.getElementById('maes-screen').textContent;
  var box=document.getElementById('cst-rpk-err');
  if(!box)return mal('caja');
  if(getComputedStyle(box).backgroundColor!=='rgb(58, 29, 29)')return mal('rojo');
  if(t.indexOf('MCOR000522')<0||t.indexOf('po_receive: Recibes más de lo pedido')<0)return mal('motivo');
  if(t.indexOf('1 recepción con error')<0)return mal('chip');
  var btn=document.getElementById('rpk-45');
  if(!btn)return mal('botón');
  mcEsAdmin=function(){return false;};
  MCCosteo.tabG('recep');
  if(document.getElementById('rpk-45'))return mal('no admin');
  if(!document.getElementById('cst-rpk-err'))return mal('aviso');
  mcEsAdmin=function(){return true;};
  MCCosteo.tabG('recep');
  document.getElementById('rpk-45').click();
  setTimeout(function(){
    if(ops.indexOf('costeo_recibo_reintentar')<0)return mal('op');
    if(document.getElementById('cst-rpk-err'))return mal('sigue');
    if(document.body.textContent.indexOf('Recepción reintentada')<0)return mal('toast');
    var sc=document.getElementById('maes-screen');
    if(sc.scrollWidth>window.innerWidth+1)return mal('ancho '+sc.scrollWidth);
    document.getElementById('result').textContent='OK';
    document.title='OK';
  },80);
},60);
</script>`;
}

function run(w) {
  const dir = '/tmp/recibo-error-' + w;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ui.html'), page(w));
  const out = spawnSync('/usr/local/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-rpk-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=4000', '--screenshot=/opt/cursor/artifacts/recibo-error-' + w + '.png', '--dump-dom', join(dir, 'ui.html')], { encoding: 'utf8', timeout: 25000 });
  const dom = (out.stdout || '') + (out.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + out.status));
  }
  console.log('OK', w);
}
run(390);
run(1280);
