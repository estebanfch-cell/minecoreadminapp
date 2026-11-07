/**
 * Recibir packing list, contrato v135. 390 px. No envía de verdad.
 *   node tests/packing-avance.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='605'")) throw new Error('build');
if (!sw.includes("var SWV='b605'")) throw new Error('sw');
if (!html.includes('-webkit-text-fill-color:#111!important')) throw new Error('contraste');
const pack = html.slice(html.indexOf('window.MCPack=(function(){'), html.indexOf('window.MCActas=(function(){'));
if (!pack.includes('Guardar avance')) throw new Error('boton');
if (!pack.includes('avance:true')) throw new Error('avance');
if (!pack.includes("onclick=\"MCPack.enviar()\"")) throw new Error('enviar');
if (pack.includes('MCActas.pad')) throw new Error('firma al guardar');
if (!pack.includes('otros_sin_contar')) throw new Error('otros');
if (!pack.includes('pk-rep')) throw new Error('reparto');
const avance = pack.slice(pack.indexOf('function persistir('), pack.indexOf('function avance('));
if (/firma\s*:/.test(avance)) throw new Error('avance manda firma');
const enviarFn = pack.slice(pack.indexOf('function enviarFirmado('), pack.indexOf('return {init'));
if (enviarFn.includes('avance:true')) throw new Error('enviar con avance');
if (enviarFn.includes('packing_acta_firmar')) throw new Error('firma doble');
if (!enviarFn.includes('borrarLocal()') || !enviarFn.includes('setTimeout(function(){init();},2000)')) throw new Error('vuelve a la lista');
if (!pack.includes('Ya enviado — solo lectura')) throw new Error('banner');
if (!html.includes('Firmar de nuevo') || !html.includes("op:'packing_acta_firmar'")) throw new Error('firmar de nuevo');
const abrir = pack.slice(pack.indexOf('function abrir('), pack.indexOf('function opts('));
if (abrir.includes('pk-firma') || abrir.includes('popupFirma')) throw new Error('firma al abrir');

const page = `<!doctype html><meta charset="utf-8"><title>avance</title>
<style>
html,body{width:390px;max-width:390px;margin:0;background:#0b1520;color:#dce6f0;font:14px -apple-system,sans-serif}
html body :is(input){color:inherit!important;-webkit-text-fill-color:currentColor!important}
html body :is(input)::placeholder{color:#6b7f94!important;-webkit-text-fill-color:#6b7f94!important}
html body :is(input):disabled{opacity:.6}
.cbz-btn,.chip{min-height:36px}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[],confirms=[];
localStorage.setItem('mc-pk-avance:MCOR-02.3.5.13:doc-40560',JSON.stringify({saved_at:'2026-11-06T15:00:00.000Z',synced_at:'2026-11-06T15:00:00.000Z',costeo:'MCOR-02.3.5.13',doc_id:'doc-40560',numero:'40560',lineas:[{id:'doc-40560:0',qty_contada:99,sublocation:null},{id:'doc-40560:1',qty_contada:8,sublocation:'10-C-1'}]}));
function MCpost(b){posts.push(JSON.parse(JSON.stringify(b)));
  if(b.op==='packing_list')return Promise.resolve({ok:true,packings:[{doc_id:'doc-40560',numero:'40560',costeo:'MCOR-02.3.5.13',proveedor:'Boyles',lineas:2,contadas:1,ocs:['MCOR-PO-000386']}]});
  if(b.op==='packing_get')return Promise.resolve({ok:true,packing:{doc_id:'doc-40560',numero:'40560',costeo:'MCOR-02.3.5.13',costeo_estado:'cruzado',proveedor:'Boyles',modo:'pdf'},sublocs:['11-B-2'],otros_sin_contar:[{numero:'40391',codigo_proveedor:'12042040004110M',producto:'WASHER',esperado:4}],lineas:[
    {id:'doc-40560:0',idx:0,producto:'WASHER',descripcion_pdf:'HO KH HEAD VALVE ADJ. WASHER',sku:'MCOR000511',codigo_proveedor:'12042040004110M',po:'MCOR-PO-000386 + MCOR-PO-000387',ocs:[{po:'MCOR-PO-000386',qty:10},{po:'MCOR-PO-000387',qty:20}],sin_oc:0,estado:'ok',factura:'F001',esperado:30,qty_contada:30,img_path:''},
    {id:'doc-40560:1',idx:1,producto:'STOP RING',descripcion_pdf:'HO KH STOP RING',sku:'MCOR000520',codigo_proveedor:'12042040011000',po:'MCOR-PO-000386',ocs:[{po:'MCOR-PO-000386',qty:150}],sin_oc:0,estado:'ok',factura:'F001',esperado:150,qty_contada:null,img_path:''}
  ]});
  if(b.op==='packing_guardar')return Promise.resolve({ok:true,avance:!!b.avance,guardado:!!b.avance,mensaje:b.avance?'Avance guardado':'Conteo enviado al costeo',acta:b.firma?{acta_id:9,version:1,nueva:true}:null});
  if(b.op==='packing_acta_firmar')return Promise.resolve({ok:true});
  return Promise.resolve({ok:false,error:'no'});
}
function getUserName(){return 'EFCH';}function getPin(){return '1';}function MCth(s){return s;}function MCfoto(){}
window._CONF=false;window.confirm=function(m){confirms.push(m);return window._CONF;};
${pack}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCPack.init();
setTimeout(function(){
  if(document.getElementById('pk-firma-ov'))return mal('firma en la lista');
  MCPack.abrir(0);
  setTimeout(function(){
    if(document.getElementById('pk-firma-ov'))return mal('firma al abrir');
    var t=document.getElementById('maes-screen').textContent;
    if(t.indexOf('12042040004110M')<0)return mal('codigo');
    if(t.indexOf('Reparto:')<0||t.indexOf('MCOR-PO-000387 20')<0)return mal('reparto');
    if(!document.getElementById('pk-otros'))return mal('otros');
    var ins=[].slice.call(document.querySelectorAll('.pk-q'));
    if(ins.length!==2)return mal('filas');
    if(ins[0].value!=='30')return mal('servidor '+ins[0].value);
    if(ins[1].value!=='8')return mal('respaldo '+ins[1].value);
    var st=getComputedStyle(ins[0]);
    if(st.color!=='rgb(17, 17, 17)'||st.webkitTextFillColor!=='rgb(17, 17, 17)'||st.fontWeight!=='700'||st.opacity!=='1')return mal('color '+st.color);
    var av=document.querySelector('.pk-av').getBoundingClientRect();
    var sv=document.querySelector('#maes-screen .pk-sv').getBoundingClientRect();
    if(av.left<0||av.right>391||sv.left<0||sv.right>391||av.bottom>sv.top+1)return mal('layout');
    ins[1].value='9';ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    setTimeout(function(){
      var saves=posts.filter(function(p){return p.op==='packing_guardar';});
      if(!saves.length||saves.some(function(p){return p.avance!==true||p.firma;}))return mal('autoguardado');
      if(saves[0].lineas[1].id!=='doc-40560:1'||saves[0].lineas[1].qty_contada!==9)return mal('id');
      if(!/Avance guardado \\d{2}:\\d{2}/.test(document.getElementById('pk-avance').textContent))return mal('hora');
      window._CONF=false;document.querySelector('#maes-screen .pk-sv').click();
      if(document.getElementById('pk-firma-ov'))return mal('popup sin confirmar');
      window._CONF=true;document.querySelector('#maes-screen .pk-sv').click();
      if(!document.getElementById('pk-firma-ov'))return mal('sin popup');
      if(confirms[confirms.length-1].indexOf('otro packing')<0)return mal('aviso envio');
      var antes=posts.filter(function(p){return p.firma||p.avance!==true&&p.op==='packing_guardar';}).length;
      document.getElementById('pk-firma-x').click();
      if(document.getElementById('pk-firma-ov'))return mal('cancel no cierra');
      if(posts.some(function(p){return p.op==='packing_guardar'&&p.avance!==true;}))return mal('cancel envio');
      window._CONF=true;document.querySelector('#maes-screen .pk-sv').click();
      var c=document.getElementById('pk-firma'),r=c.getBoundingClientRect();
      function ev(ty,x,y){c.dispatchEvent(new PointerEvent(ty,{clientX:r.left+x,clientY:r.top+y,bubbles:true,pointerId:1}));}
      ev('pointerdown',8,8);ev('pointermove',20,16);ev('pointermove',40,12);ev('pointermove',55,20);ev('pointerup',55,20);
      document.getElementById('pk-firma-ok').click();
      setTimeout(function(){
        var env=posts.filter(function(p){return p.op==='packing_guardar'&&p.avance!==true;});
        if(env.length!==1||!env[0].firma)return mal('envios '+env.length);
        if(env[0].lineas[0].id!=='doc-40560:0')return mal('id envio');
        if(posts.some(function(p){return p.op==='packing_acta_firmar';}))return mal('firmo dos veces');
        if(document.getElementById('pk-firma-ov')||document.querySelector('#maes-screen #pk-firma'))return mal('firma quedo');
        document.getElementById('result').textContent='OK';
        document.title='OK';
      },80);
    },1000);
  },80);
},80);
</script>`;

const dir = '/tmp/packing-avance';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ui.html'), page);
const chrome = '/usr/local/bin/google-chrome';
const shot = '/opt/cursor/artifacts/packing-avance-390.png';
const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-pkav', '--window-size=390,1000', '--virtual-time-budget=5000', '--screenshot=' + shot, '--dump-dom', join(dir, 'ui.html')], { encoding: 'utf8', timeout: 25000 });
const dom = (run.stdout || '') + (run.stderr || '');
if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  throw new Error(m ? m[1] : 'sin resultado ' + run.status);
}
console.log('390 OK', shot);
