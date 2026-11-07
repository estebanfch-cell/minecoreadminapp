/**
 * Envío de packing: una sola firma, vuelve a la lista y el ya enviado queda en solo lectura.
 *   node tests/packing-enviado.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const pack = html.slice(html.indexOf('window.MCPack=(function(){'), html.indexOf('window.MCActas=(function(){'));
const h2 = html.slice(html.indexOf('function MCHistEdit()'), html.indexOf('/* b356-costos-ini'));
const mcrow = html.slice(html.indexOf('var MCrow='), html.indexOf('/* b476 REGLA'));

const page = `<!doctype html><meta charset="utf-8"><title>enviado</title>
<div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[],alerts=0;
window.alert=function(){alerts++;};
window.confirm=function(){return true;};
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function getProfile(){return {rol:'admin',modulos:['~hist.e.actas=1']};}
function MCcan(){return true;}function MCth(s){return s;}function MCfoto(){}
function MCpost(b){posts.push(JSON.parse(JSON.stringify(b)));
  if(b.op==='packing_list')return Promise.resolve({ok:true,packings:window._LIST||[]});
  if(b.op==='packing_get')return Promise.resolve({ok:true,packing:{doc_id:b.doc_id,numero:'40560',costeo:'MCOR-02.3.5.13',costeo_estado:'cruzado',proveedor:'Boyles',modo:'pdf'},sublocs:['11-B-2'],lineas:[
    {id:'doc-40560:0',producto:'WASHER',codigo_proveedor:'12042040004110M',esperado:30,qty_contada:30,estado:'ok'}
  ]});
  if(b.op==='packing_guardar'){
    if(window._YA)return Promise.reject(new Error('Este packing ya se envió al costeo. Ábrelo desde Historial.'));
    return Promise.resolve({ok:true,mensaje:'Conteo enviado al costeo',acta:{acta_id:9}});
  }
  if(b.op==='historial_list')return Promise.resolve({ok:true,filas:[
    {id:'doc-40560',numero:'40560',fecha:'2026-11-06T20:00:00Z',proveedor:'Boyles',estado:'Conteo enviado',acta_id:9,acta_firmada:false},
    {id:'doc-1',numero:'40391',fecha:'2026-11-05T20:00:00Z',proveedor:'Boyles',estado:'Conteo enviado',acta_id:8,firmado_nombre:'Ana',firmado_at:'2026-11-05T21:00:00Z',acta_firmada:true}
  ]});
  if(b.op==='packing_acta_firmar')return Promise.resolve({ok:true});
  return Promise.resolve({ok:false,error:'no'});
}
${mcrow}
${h2}
${pack}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
localStorage.setItem('mc-pk-avance:MCOR-02.3.5.13:doc-40560','{"saved_at":"2026-11-06T15:00:00.000Z","lineas":[{"id":"doc-40560:0","qty_contada":1}]}');
window._LIST=[{doc_id:'doc-40560',numero:'40560',costeo:'MCOR-02.3.5.13',proveedor:'Boyles',lineas:1,contadas:0,ocs:[]}];
window._YA=1;
MCPack.init();
setTimeout(function(){
  MCPack.abrir(0);
  setTimeout(function(){
    var q=document.querySelector('.pk-q');
    q.value='4';q.dispatchEvent(new Event('input',{bubbles:true}));
    setTimeout(function(){
      if(!document.getElementById('pk-ya'))return mal('sin banner');
      if(document.querySelectorAll('#pk-ya').length!==1)return mal('banner doble');
      if(alerts)return mal('alerta '+alerts);
      if(document.querySelector('.pk-av')||document.querySelector('.pk-sv'))return mal('botones');
      if(!q.readOnly&&document.querySelector('.pk-q')&&!document.querySelector('.pk-q').readOnly)return mal('input');
      if(localStorage.getItem('mc-pk-avance:MCOR-02.3.5.13:doc-40560'))return mal('borrador');
      var n=posts.filter(function(p){return p.op==='packing_guardar';}).length;
      document.querySelector('.pk-q').dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){
        if(posts.filter(function(p){return p.op==='packing_guardar';}).length!==n)return mal('reintento');
        if(alerts)return mal('alerta 2');
        MCHist2.abrir('packing');
        setTimeout(function(){
          var btns=[].slice.call(document.querySelectorAll('#mh2-ov button'));
          var firm=btns.filter(function(b){return b.textContent==='Firmar de nuevo';});
          if(firm.length!==1)return mal('boton firma '+firm.length);
          document.querySelector('#mh2-ov .mcrow').click();
          setTimeout(function(){
            if(document.querySelector('.pk-av')||document.querySelector('.pk-sv'))return mal('historial editable');
            if(!document.querySelector('.pk-q').readOnly)return mal('historial input');
            document.querySelector('.cbz-btn').click();
            setTimeout(function(){
              firm[0]=document.querySelector('#mh2-ov button');
              var b=[].slice.call(document.querySelectorAll('#mh2-ov button')).filter(function(x){return x.textContent==='Firmar de nuevo';})[0];
              b.click();
              var c=document.getElementById('mh2-cv'),r=c.getBoundingClientRect();
              function ev(ty,x,y){c.dispatchEvent(new PointerEvent(ty,{clientX:r.left+x,clientY:r.top+y,bubbles:true,pointerId:1}));}
              ev('pointerdown',8,8);ev('pointermove',20,16);ev('pointermove',40,12);ev('pointermove',55,20);ev('pointerup',55,20);
              var antes=posts.length;
              document.getElementById('mh2-fok').click();
              setTimeout(function(){
                var f=posts.filter(function(p){return p.op==='packing_acta_firmar';});
                if(f.length!==1||f[0].action!=='packing'||f[0].acta_id!==9||!f[0].firma||!f[0].nombre)return mal('firmar');
                if(posts.slice(antes).some(function(p){return p.op==='packing_guardar';}))return mal('reenvio');
                if(document.querySelector('#mh2-ov')&&document.querySelector('#mh2-ov').textContent.indexOf('Firmar de nuevo')>=0)return mal('sigue el boton');
                window._YA=0;window._LIST=[{doc_id:'doc-40560',numero:'40560',costeo:'MCOR-02.3.5.13',proveedor:'Boyles',lineas:1,contadas:0,ocs:[]}];
                localStorage.setItem('mc-pk-avance:MCOR-02.3.5.13:doc-40560','{"saved_at":"2026-11-06T15:00:00.000Z","lineas":[]}');
                MCHist2.cerrar();
                MCPack.init();
                setTimeout(function(){
                  MCPack.abrir(0);
                  setTimeout(function(){
                    document.querySelector('.pk-sv').click();
                    var c2=document.getElementById('pk-firma'),r2=c2.getBoundingClientRect();
                    function ev2(ty,x,y){c2.dispatchEvent(new PointerEvent(ty,{clientX:r2.left+x,clientY:r2.top+y,bubbles:true,pointerId:1}));}
                    ev2('pointerdown',8,8);ev2('pointermove',20,16);ev2('pointermove',40,12);ev2('pointermove',55,20);ev2('pointerup',55,20);
                    document.getElementById('pk-firma-ok').click();
                    setTimeout(function(){
                      if(localStorage.getItem('mc-pk-avance:MCOR-02.3.5.13:doc-40560'))return mal('borrador envio');
                      if(document.getElementById('maes-screen').textContent.indexOf('Conteo enviado al costeo')<0)return mal('mensaje');
                      if(posts.filter(function(p){return p.op==='packing_acta_firmar';}).length!==1)return mal('firma doble');
                      window._LIST=[];
                      setTimeout(function(){
                        var t=document.getElementById('maes-screen').textContent;
                        if(t.indexOf('No hay packing lists por recibir')<0)return mal('lista');
                        if(t.indexOf('40560')>=0)return mal('sigue en la lista');
                        document.getElementById('result').textContent='OK';
                        document.title='OK';
                      },2100);
                    },50);
                  },40);
                },40);
              },40);
            },40);
          },40);
        },40);
      },900);
    },900);
  },40);
},40);
</script>`;

const dir = '/tmp/packing-enviado';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ui.html'), page);
const chrome = '/usr/local/bin/google-chrome';
const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-pkenv', '--window-size=390,900', '--virtual-time-budget=8000', '--dump-dom', join(dir, 'ui.html')], { encoding: 'utf8', timeout: 25000 });
const dom = (run.stdout || '') + (run.stderr || '');
if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  throw new Error(m ? m[1] : 'sin resultado ' + run.status);
}
console.log('OK');
