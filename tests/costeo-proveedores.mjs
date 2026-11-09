/**
 * Lista de costeos: el proveedor no se corta. 320/375/390/430 y escritorio.
 *   node tests/costeo-proveedores.mjs
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
const fmt = html.slice(html.indexOf('/* MCCOSTEO-FMT-BEGIN */'), html.indexOf('/* MCCOSTEO-FMT-END */') + '/* MCCOSTEO-FMT-END */'.length);
const pack = html.slice(html.indexOf('var MCCosteo=(function(){'), html.indexOf('/* ---------- b357: Configuración'));

function page(w){
  return `<!doctype html><meta charset="utf-8"><title>prov</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}
#maes-screen{width:${w}px;max-width:${w}px;overflow:hidden}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[];
function getProfile(){return {rol:'admin'};}
function getUserName(){return 'EFCH';}function getPin(){return '1';}
window.MCroute={set:function(){}};
function MCpost(b){posts.push(b.op);var LARGO='BOYLES INTERNATIONAL TRADING CO';
  if(b.op==='costeo_list')return Promise.resolve({ok:true,markup:0.25,costeos:[
    {id:'c16',codigo:'MCOR-02.3.5.16',proveedores:LARGO,ocs:'MCOR-PO-000401, MCOR-PO-000402',totales:{FOB:6819.35,AF:8577.80},estado:'cerrado',fecha:'2026-10-30'},
    {id:'c15',codigo:'MCOR-02.3.5.15',proveedores:'',ocs:'MCOR-PO-000399',totales:{FOB:8100,AF:11628.66},estado:'cerrado',fecha:'2026-10-27'},
    {id:'c13',codigo:'MCOR-02.3.5.13',proveedores:'BOYLES + ACME TOOLS',ocs:'MCOR-PO-000386',totales:{FOB:53266.39,AF:61315.90},estado:'pre_recibido',fecha:'2026-10-27'},
    {id:'c0',codigo:'MCOR-02.3.5.0',proveedores:null,ocs:'',totales:{FOB:1,AF:1},estado:'borrador',fecha:'2026-10-01'}
  ]});
  if(b.op==='costeo_get')return Promise.resolve({ok:true,costeo:{},lineas:[{proveedor:LARGO,po:'MCOR-PO-000399'}],ocs:[{order_number:'MCOR-PO-000399',proveedor:LARGO}]});
  return Promise.resolve({ok:false,error:'no'});
}
${fmt}
${pack}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCCosteo.init();
setTimeout(function(){
  var box=document.getElementById('maes-screen');
  var vals=[].slice.call(document.querySelectorAll('.cst-val'));
  var largo=vals.filter(function(v){return v.textContent==='BOYLES INTERNATIONAL TRADING CO';});
  if(largo.length<2)return mal('nombres '+largo.length);
  var borde=box.getBoundingClientRect().right,range=document.createRange();
  if(largo.some(function(v){range.selectNodeContents(v);var rr=range.getBoundingClientRect();return rr.right>borde-8||v.scrollWidth>v.clientWidth+2;}))return mal('cortado');
  var fob=document.querySelector('[data-l="FOB"]');
  if(fob.textContent.indexOf('6,819.35')<0)return mal('fob');
  range.selectNodeContents(fob);if(range.getBoundingClientRect().right>borde-8)return mal('fob fuera');
  if(getComputedStyle(largo[0]).textAlign!=='right')return mal('alineacion');
  var filas=[].slice.call(document.querySelectorAll('.cst-t tr'));
  var vacia=filas.filter(function(tr){return tr.textContent.indexOf('MCOR-02.3.5.0')>=0;})[0];
  var cel=vacia.querySelector('.cst-provs .cst-val');
  if(!cel||cel.textContent!=='—')return mal('vacio');
  var chip=[].slice.call(document.querySelectorAll('.cst-ocb')).filter(function(b){return b.textContent.indexOf('Consolidado (2)')>=0;})[0];
  if(!chip)return mal('chip');
  if(chip.getBoundingClientRect().right>borde+1)return mal('chip fuera');
  chip.click();
  var pop=document.getElementById('cst-ocpop');
  if(!pop||pop.textContent.indexOf('ACME TOOLS')<0||pop.textContent.indexOf('BOYLES')<0)return mal('lista');
  if(posts.indexOf('costeo_get')<0)return mal('sin derivar');
  document.getElementById('result').textContent='OK';
  document.title='OK';
},200);
</script>`;
}

const dir = '/tmp/costeo-proveedores';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [320, 375, 390, 430, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const shot = w === 390 ? ['--screenshot=/opt/cursor/artifacts/costeo-proveedores-390.png'] : [];
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-cstp-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=2500', ...shot, '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
