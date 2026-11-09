/**
 * Entregar: lista de verificación y PDF del cliente, en 390 y escritorio.
 *   node tests/entrega-checklist.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='625'")) throw new Error('build');
if (!sw.includes("var SWV='b625'")) throw new Error('sw');
if (!html.includes('ent-checklist')) throw new Error('api');
if (!html.includes("k==='ent.checklist'")) throw new Error('permiso');
const mcrow = html.slice(html.indexOf('var MCrow='), html.indexOf('/* b476 REGLA'));
const ent = html.slice(html.indexOf('var MCEnt=(function(){'), html.indexOf('/* b353 t628:'));

function page(w){
  return `<!doctype html><meta charset="utf-8"><title>chk</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}
#maes-screen,#ent{width:${w}px;max-width:${w}px;box-sizing:border-box}
.chip,.cbz-btn,.cbz-btn-sec{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6}
.cbz-card{border:1px solid #1c2a3a;border-radius:12px;padding:8px;margin:6px 0}
.uinput{width:100%;box-sizing:border-box}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[],alerts=[];
window.alert=function(m){alerts.push(String(m));};
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function getProfile(){return {rol:'admin',modulos:['~ent.checklist=1']};}
function MCcan(){return false;}
function MCerr(e){return String(e&&e.message||e);}function toast(){}
function MCsbGet(){return {t:'tok',u:'EFCH'};}
window.MCnom={quien:function(s){return '<span data-mcnom="'+s+'">'+s+'</span>';},nom:function(s){return s;}};
var MCFirmaR={boton:function(){return '<span class="dig">DIGITAL</span>';},abrir:function(){}};
var STORE={};
function L(){return [{k:'1|MCOR1|0',sku:'MCOR1',nombre:'TUBO INTERNO',cantidad:2,img:'https://example.invalid/fotos/th160/tubo.jpg',sub:'10-B-2'},{k:'2|MCOR2|1',sku:'MCOR2',nombre:'BROCA HQ',cantidad:1,img:'',sub:''}];}
var fotos=[];
function MCfoto(u,ev){if(ev)ev.stopPropagation();fotos.push(u);}
function MCth(u){return u;}
function MCpost(b){posts.push(JSON.parse(JSON.stringify(b)));
  if(b.op==='ent_list')return Promise.resolve({ok:true,ordenes:[{id:'so-1',order_number:'MCOR-SO-009001',cliente:'CLIENTE PRUEBA',lineas:2}],entregadas:[]});
  if(b.op==='ent_get')return Promise.resolve({ok:true,orden:{id:b.id,order_number:'MCOR-SO-009001',cliente:'CLIENTE PRUEBA'},lineas:[{nombre:'TUBO INTERNO',sku:'MCOR1',cantidad:2},{nombre:'BROCA HQ',sku:'MCOR2',cantidad:1}],fotos:[],entrega:null});
  if(b.op==='doc')return Promise.resolve({ok:true,doc:{num:'MCOR-SO-009001',lineas:[],cajas:[]}});
  return Promise.resolve({ok:false,error:'no'});
}
window.fetch=function(url,opt){var b=JSON.parse(opt.body);if(String(url).indexOf('ent-checklist')<0)return Promise.reject(new Error('url'));
  if(b.op==='marcar')STORE[b.id]=(b.lineas||[]).slice();
  var m=STORE[b.id]||[],lineas=L(),listo=m.length===lineas.length&&lineas.length>0,precios=window._PRECIOS!==false;
  return Promise.resolve({json:function(){return Promise.resolve(window._CHK===false?{ok:true,checklist:false}:{ok:true,checklist:true,precios:precios,lineas:lineas,marcadas:m,n:lineas.length,listo:listo,por:listo?'EFCH':null,por_nombre:listo?'Esteban Ferlito':null,at:listo?'09/11/2026 14:05 (EC)':null,factura:precios?{nombre:'FAC-1.pdf',url:'https://example.invalid/fac.pdf'}:null});}});};
function cargarPdfjs(){return Promise.resolve();}
window.pdfjsLib={getDocument:function(){
  var page={getViewport:function(o){var s=(o&&o.scale)||1;return {width:400*s,height:560*s};},render:function(){return {promise:Promise.resolve()};}};
  return {promise:Promise.resolve({numPages:2,getPage:function(){return Promise.resolve(page);}})};
}};
function MCInflowDoc(){return Promise.resolve(new Blob(['%PDF-1.4'],{type:'application/pdf'}));}
${mcrow}
${ent}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCEnt.init();
setTimeout(function(){
  document.querySelector('.mcrow').click();
  setTimeout(function(){
    var d=document.getElementById('ent');
    if(!document.getElementById('ent-ov')||!document.getElementById('ent-fac'))return mal('pdf');
    var row0=document.querySelectorAll('.chk-row')[0];
    if(!row0.querySelector('.chk-foto'))return mal('foto');
    if(row0.textContent.indexOf('TUBO INTERNO')<0||row0.textContent.indexOf('MCOR1')<0||row0.textContent.indexOf('10-B-2')<0)return mal('tarjeta');
    row0.querySelector('.chk-foto').click();
    if(!fotos.length)return mal('ampliar');
    if(document.getElementById('ent-chk-n').textContent!=='0/2')return mal('foto marco');
    if(d.textContent.indexOf('0/2')<0)return mal('contador '+d.textContent.slice(0,80));
    var g=document.getElementById('ent-guardar'),f=document.getElementById('ent-firmar');
    if(!g.disabled||!f.disabled)return mal('abierto');
    document.querySelectorAll('.chk-row')[0].click();
    if(document.getElementById('ent-chk-n').textContent!=='1/2')return mal('uno');
    if(!document.getElementById('ent-guardar').disabled||!document.getElementById('ent-firmar').disabled)return mal('medio');
    document.querySelectorAll('.chk-row')[1].click();
    if(document.getElementById('ent-chk-n').textContent!=='2/2')return mal('dos');
    if(document.getElementById('ent-firmar').disabled)return mal('firma');
    if(!document.getElementById('ent-guardar').disabled)return mal('sin evidencia');
    setTimeout(function(){
      if(!STORE['so-1']||STORE['so-1'].length!==2)return mal('no guardó');
      MCEnt.abrir('so-1');
      setTimeout(function(){
        var t=document.getElementById('ent').textContent;
        if(document.getElementById('ent-chk-n').textContent!=='2/2')return mal('recarga');
        if(t.indexOf('Esteban Ferlito')<0)return mal('nombre');
        if(t.indexOf('$')>=0)return mal('precio en lista');
        document.querySelectorAll('.chk-row')[0].click();
        if(!document.getElementById('ent-firmar').disabled)return mal('desmarca');
        document.querySelectorAll('.chk-row')[0].click();
        document.getElementById('ent-ov').click();
        setTimeout(function(){
          if(!posts.some(function(p){return p.op==='doc';}))return mal('doc');
          if(!document.querySelector('#ent-pags canvas'))return mal('visor');
          if(!document.getElementById('ent-full'))return mal('completo');
          var box=document.getElementById('ent');
          var r=box.getBoundingClientRect();
          var fuera=[].some.call(box.querySelectorAll('.chk-row,#ent-ov,#ent-fac,#ent-firmar,#ent-guardar'),function(el){var b=el.getBoundingClientRect();return b.right>r.right+1||b.left<r.left-1||b.width<40;});
          if(fuera)return mal('ancho');
          MCEnt.docFull();
          if(!document.getElementById('ent-vis').classList.contains('full'))return mal('full');
          window._PRECIOS=false;
          MCEnt.abrir('so-1');
          setTimeout(function(){
            var e=document.getElementById('ent');
            if(document.getElementById('ent-ov')||document.getElementById('ent-fac'))return mal('oswaldo pdf');
            if(e.textContent.indexOf('no se muestran')<0)return mal('aviso');
            if(!e.querySelector('.chk-row'))return mal('sin lista');
            if(e.textContent.indexOf('$')>=0)return mal('precio oswaldo');
            document.getElementById('result').textContent='OK';
            document.title='OK';
          },40);
        },40);
      },40);
    },400);
  },40);
},40);
</script>`;
}

const dir = '/tmp/entrega-checklist';
mkdirSync(dir, { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const shot = ['--screenshot=/opt/cursor/artifacts/entrega-checklist-' + w + '.png'];
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-chk-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=8000', ...shot, '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
