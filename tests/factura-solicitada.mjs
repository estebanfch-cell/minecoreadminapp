/**
 * Factura solicitada es solo texto ámbar. Pago filtra varios estados. 390 y escritorio.
 *   node tests/factura-solicitada.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='628'")) throw new Error('build');
if (!sw.includes("var SWV='b628'")) throw new Error('sw');
if (html.includes('mcFacSolTap') || html.includes('data-cuando')) throw new Error('sigue el detalle de quién pidió');
if (!html.includes("mcFMul('Pago'")) throw new Error('pago');
if (!html.includes("mcFMul('Estado'")) throw new Error('estado');
if (!html.includes("mcFMul('Inventario'")) throw new Error('inventario');
if (!html.includes("mcFMul('Factura'")) throw new Error('factura');
if (!html.includes("id=\"vt-tmin\"") && !html.includes('id="vt-tmin"')) throw new Error('total');
if (!html.includes('vistaOk')) throw new Error('filtro');
const bloque = html.slice(html.indexOf('function mcFacSolViva'), html.indexOf('function mcFacEnv'));
if (!bloque.includes('function mcPagoOk') || !bloque.includes('function mcFMul')) throw new Error('funciones');

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>pago</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}
.chip{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6;min-height:36px}
.uinput{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6;min-height:36px;box-sizing:border-box}
#pan,#list{box-sizing:border-box;width:${w}px;padding:8px}
.row{padding:8px 0;border-bottom:1px solid #26405c}
#result{padding:8px;color:#b7f34a;font-size:12px}</style>
<div id="pan"></div><div id="list"></div><div id="result"></div>
<script>
function mcPayEst(o){return o.payment_status||'uninvoiced';}
${bloque}
var Ventas={togK:function(k,v){var a=String(sel[k]||'').split(',').filter(Boolean),i=a.indexOf(v);if(i>=0)a.splice(i,1);else a.push(v);sel[k]=a.join(',');pintar();}};
var sel={pago:''};
var rows=[
  {id:'a',payment_status:'uninvoiced',cliente:'A'},
  {id:'b',payment_status:'uninvoiced',fac_sol:{at:'2026-11-09T21:40:00Z'},cliente:'B'},
  {id:'c',payment_status:'invoiced',factura_sri:'001-001-9',is_invoiced:true,cliente:'C'},
  {id:'d',payment_status:'paid',factura_sri:'001-001-8',is_invoiced:true,cliente:'D'}
];
function etq(o){if(mcFacSolViva(o))return mcFacSolEtq();var m={uninvoiced:'Sin factura',invoiced:'Por cobrar',paid:'Pagada',partial:'Pago parcial'}[mcPagoClave(o)];return '<span class="tag">'+m+'</span>';}
function pintar(){
  document.getElementById('pan').innerHTML=mcFMul('Pago','pago',[['uninvoiced','Sin factura'],['sol','Factura solicitada'],['invoiced','Por cobrar'],['partial','Pago parcial'],['paid','Pagada']],sel.pago);
  var vis=rows.filter(function(o){return mcPagoOk(o,sel.pago);});
  document.getElementById('list').innerHTML=vis.map(function(o){return '<div class="row" data-id="'+o.id+'">'+etq(o)+'</div>';}).join('');
}
pintar();
document.querySelector('[data-v="uninvoiced"]').click();
document.querySelector('[data-v="sol"]').click();
var list=document.getElementById('list');
var pan=document.getElementById('pan');
var b=list.querySelector('[data-id="b"] .mc-facsol');
if(b)b.click();
var ids=[].map.call(list.querySelectorAll('[data-id]'),function(n){return n.getAttribute('data-id');}).join(',');
var ok=ids==='a,b'
  &&list.textContent.indexOf('Por cobrar')<0
  &&list.textContent.indexOf('Pagada')<0
  &&list.textContent.indexOf('Sin factura')>=0
  &&list.textContent.indexOf('Factura solicitada')>=0
  &&!document.getElementById('mc-facsol-pop')
  &&b&&getComputedStyle(b).color==='rgb(240, 192, 64)'
  &&b.textContent==='Factura solicitada'
  &&pan.scrollWidth<=pan.clientWidth+2
  &&list.scrollWidth<=list.clientWidth+2;
document.getElementById('result').textContent=ok?'OK':('FAIL '+ids+' | '+list.textContent.slice(0,160)+' sw '+pan.scrollWidth+'/'+pan.clientWidth);
document.title=document.getElementById('result').textContent;
</script>`;
}

const dir = '/tmp/factura-solicitada';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=/tmp/chrome-fac2-${w}`, `--window-size=${w},900`, '--virtual-time-budget=2500', '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== 'OK') throw new Error(w + ' ' + (m ? m[1] : dom.slice(-800)));
  console.log(w, 'OK');
}
