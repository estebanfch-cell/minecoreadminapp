/**
 * Al enviar un packing se muestra el recibo del servidor y el aviso si el inventario falla.
 *   node tests/recibo-packing.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='606'")) throw new Error('build');
if (!sw.includes("var SWV='b606'")) throw new Error('sw');
if (html.includes('cuando EFCH aprueba el costeo')) throw new Error('texto viejo');
if (!html.includes('Cada packing entra al inventario al enviarlo. El costeo queda parcialmente recibido hasta que EFCH lo cierre.')) throw new Error('texto');
if (!html.includes('Recibido parcial por packing')) throw new Error('chip');
const fmt = html.slice(html.indexOf('/* MCCOSTEO-FMT-BEGIN */'), html.indexOf('/* MCCOSTEO-FMT-END */') + '/* MCCOSTEO-FMT-END */'.length);
const costeo = html.slice(html.indexOf('var MCCosteo=(function(){'), html.indexOf('/* ---------- b357: Configuración'));
const pack = html.slice(html.indexOf('window.MCPack=(function(){'), html.indexOf('window.MCActas=(function(){'));

const page = `<!doctype html><meta charset="utf-8"><title>recibo</title>
<div id="maes-screen"></div><div id="result"></div>
<script>
function getProfile(){return {rol:'admin'};}
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function MCcan(){return false;}function MCth(s){return s;}function MCfoto(){}
window.MCroute={set:function(){}};
window.confirm=function(){return true;};
function MCpost(b){
  if(b.op==='packing_list')return Promise.resolve({ok:true,packings:[{doc_id:'doc-1',numero:'40560',costeo:'MCOR',proveedor:'Boyles',lineas:1,contadas:0,ocs:[]}]});
  if(b.op==='packing_get')return Promise.resolve({ok:true,packing:{doc_id:'doc-1',numero:'40560',costeo:'MCOR',costeo_estado:'cruzado',proveedor:'Boyles'},sublocs:['11-B-2'],lineas:[{id:'L1',producto:'WASHER',codigo_proveedor:'120',esperado:3,qty_contada:3,sku:'MCOR000511'}]});
  if(b.op==='packing_guardar'&&b.firma)return Promise.resolve({ok:true,prueba:!!b.prueba,mensaje:'Packing 40560 ingresado a Bodega principal',recibo_packing:{
    recibido:[{sku:'MCOR000511',oc:'MCOR-PO-000386',cantidad:3,sububicacion:'11-B-2',costo_provisional:12.5}],
    errores:['sin producto MCOR000999']
  }});
  if(b.op==='costeo_list')return Promise.resolve({ok:true,markup:0.25,costeos:[{id:'c1',codigo:'MCOR-02.3.5.13',proveedores:'BOYLES',ocs:'PO-1',totales:{FOB:100,AF:110},estado:'pre_recibido',fecha:'2026-10-27',cierre:{recibo_parcial:true}}]});
  if(b.op==='costeo_get')return Promise.resolve({ok:true,markup:0.25,costeo:{id:'c1',codigo:'MCOR-02.3.5.13',estado:'pre_recibido',isd_rate:0.05,cierre:{recibo_parcial:true}},totales:{M:1,Q:1,U:1,AE:1,V:1,AF:1,AQ:1},lineas:[],discrepancias:[],docs:[],historial:[]});
  return Promise.resolve({ok:true});
}
${fmt}
${costeo}
${pack}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCPack.init();
setTimeout(function(){
  MCPack.abrir(0);
  setTimeout(function(){
    if(document.getElementById('maes-screen').textContent.indexOf('Cada packing entra al inventario al enviarlo')<0)return mal('leyenda');
    if(document.getElementById('maes-screen').textContent.indexOf('aprueba el costeo')>=0)return mal('viejo');
    window.MC_PACK_PRUEBA=true;
    document.querySelector('.pk-sv').click();
    var c=document.getElementById('pk-firma'),r=c.getBoundingClientRect();
    function ev(ty,x,y){c.dispatchEvent(new PointerEvent(ty,{clientX:r.left+x,clientY:r.top+y,bubbles:true,pointerId:1}));}
    ev('pointerdown',8,8);ev('pointermove',20,16);ev('pointermove',40,12);ev('pointermove',55,20);ev('pointerup',55,20);
    document.getElementById('pk-firma-ok').click();
    setTimeout(function(){
      var t=document.getElementById('maes-screen').textContent;
      if(t.indexOf('Packing 40560 ingresado a Bodega principal')<0)return mal('mensaje');
      if(t.indexOf('MCOR000511 · MCOR-PO-000386 · 3 · 11-B-2 · costo provisional US$ 12.50')<0)return mal('fila');
      var err=document.getElementById('pk-recibo-err');
      if(!err||err.textContent.indexOf('El conteo se envió, pero el ingreso al inventario falló: sin producto MCOR000999')<0)return mal('error');
      if(getComputedStyle(err).backgroundColor!=='rgb(58, 29, 29)')return mal('rojo');
      MCCosteo.init();
      setTimeout(function(){
        if(document.body.textContent.indexOf('Recibido parcial por packing')<0)return mal('chip lista');
        document.querySelector('.cst-cod').click();
        setTimeout(function(){
          var chips=[].slice.call(document.querySelectorAll('.cst-chip')).map(function(x){return x.textContent;});
          if(chips.indexOf('Recibido parcial por packing')<0)return mal('chip ficha');
          document.getElementById('result').textContent='OK';
          document.title='OK';
        },40);
      },40);
    },40);
  },40);
},40);
</script>`;

const dir = '/tmp/recibo-packing';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ui.html'), page);
const run = spawnSync('/usr/local/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-recibo', '--window-size=390,900', '--virtual-time-budget=4000', '--screenshot=/opt/cursor/artifacts/recibo-packing-390.png', '--dump-dom', join(dir, 'ui.html')], { encoding: 'utf8', timeout: 25000 });
const dom = (run.stdout || '') + (run.stderr || '');
if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  throw new Error(m ? m[1] : 'sin resultado ' + run.status);
}
console.log('OK');
