/**
 * Cambiar ubicación: busca, mueve con Todo y se queda para el siguiente. 390 y escritorio.
 *   node tests/cambiar-ubicacion.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='624'")) throw new Error('build');
if (!sw.includes("var SWV='b624'")) throw new Error('sw');
if (!html.includes('~inv.e.ubicar=1') && !html.includes("k==='inv.e.ubicar'")) throw new Error('interruptor');
if (!html.includes('nueva:true')) throw new Error('fila nueva');
if (!html.includes("tabla:'sububicaciones'")) throw new Error('crea sub');
const ubi = html.slice(html.indexOf('var MCUbi=(function(){'), html.indexOf('var MCUbic=(function(){'));
if (!ubi.includes('function confirmar')) throw new Error('modulo');

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>ubi</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}
.uinput,.chip,.cbz-btn{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6;min-height:44px}
#result{padding:8px;color:#b7f34a;font-size:12px}</style>
<div id="result"></div>
<script>
var posts=[];
function getUserName(){return 'EFCH';}
function MCcan(k){return k==='inv.e.ubicar'&&window._ON!==false;}
function MCsbGet(){return {t:'tok'};}
function alert(m){document.getElementById('result').textContent='FAIL '+m;document.title='FAIL';}
window.MCnom={_n:'',poner:function(u,n){this._n=n;},nom:function(){return this._n||'EFCH';}};
window.fetch=function(url,opt){var b=JSON.parse(opt.body);posts.push(b);
  function ok(x){return Promise.resolve({json:function(){return Promise.resolve(x);}});}
  if(b.op==='buscar')return ok({ok:true,productos:[{id:'11111111-1111-4111-8111-111111111522',sku:'MCOR000522',name:'PRODUCTO 522'}]});
  if(b.op==='ver')return ok({ok:true,nombre:'Esteban Ferlito',producto:{id:b.id,sku:'MCOR000522',nombre:'PRODUCTO 522',filas:[{sub:'10-B-2',q:30},{sub:'8-A-1',q:4}],subs:['10-B-2','8-A-1','11-C-4'],predeterminada:'10-B-2',manual:false,auto:'10-B-2'}});
  if(b.op==='mover')return ok({ok:true,number:'MCOR-ST-9',nombre:'Esteban Ferlito',at:'09/11/2026 16:10 (EC)',desde:b.desde,hasta:b.hasta,qty:b.qty,predeterminada:!!b.predeterminada});
  return ok({ok:false,error:'no'});
};
${ubi}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCUbi.abrir();
var box=document.getElementById('ubi-box');
if(!box)mal('no abre');
else {
  box.style.width='${w}px';
  var q=document.getElementById('ubi-q');
  q.value='MCOR000522';q.dispatchEvent(new Event('input'));
  setTimeout(function(){
    if(!document.querySelector('.ubi-sub'))return mal('stock '+(box.textContent||'').slice(0,80));
    document.querySelector('.ubi-sub').click();
    MCUbi.todo();
    var sel=document.getElementById('ubi-d');
    sel.value='__nueva';sel.dispatchEvent(new Event('change'));
    var nn=document.getElementById('ubi-n');
    if(!nn)return mal('crear');
    nn.value='11-C-9';MCUbi.nueva('11-C-9');
    document.querySelector('.ubi-chk input').checked=true;MCUbi.fijar(true);
    document.querySelector('.ubi-go').click();
    setTimeout(function(){
      var mv=posts.filter(function(p){return p.op==='mover';})[0];
      var tx=box.textContent;
      var fuera=box.scrollWidth>box.clientWidth+2;
      if(fuera)return mal('ancho');
      if(!mv||mv.desde!=='10-B-2'||mv.hasta!=='11-C-9'||mv.qty!==30||mv.predeterminada!==true)return mal('mover');
      if(tx.indexOf('Esteban Ferlito')<0||tx.indexOf('11-C-9')<0)return mal('hecho');
      if(!document.getElementById('ubi-q'))return mal('salio');
      window._ON=false;MCUbi.cerrar();MCUbi.abrir();
      if(document.getElementById('ubi-box'))return mal('sin permiso');
      document.getElementById('result').textContent='OK';document.title='OK';
    },40);
  },400);
}
</script>`;
}

const dir = '/tmp/cambiar-ubicacion';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-ubi-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=3000', '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
