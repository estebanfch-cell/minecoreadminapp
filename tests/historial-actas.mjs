/**
 * Historial: filas compactas y detalle solo lectura. 390 y 1280.
 *   node tests/historial-actas.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='595'")) throw new Error('build');
if (!sw.includes("var SWV='b595'")) throw new Error('sw');
if (!html.includes("Ac('hist.e.actas','Historial y actas'")) throw new Error('switch');
if (!html.includes("k==='hist.e.actas'")) throw new Error('mccan');
if (!html.includes("x[1]!=='hist.e.actas'")) throw new Error('preset');
if (!html.includes('historial_list|acta_datos')) throw new Error('lect');
if (!html.includes("MCHist2.abrir(\\'preparar\\')") || !html.includes("MCHist2.abrir(\\'entregar\\')") || !html.includes("MCHist2.abrir(\\'packing\\')")) throw new Error('botones');
if (!html.includes("op:'ent_hist'")) throw new Error('MCHist roto');
const h2 = html.slice(html.indexOf('function MCHistEdit()'), html.indexOf('/* b356-costos-ini'));
if (!h2.includes('📄 PDF')) throw new Error('pdf');
if (!h2.includes('Buscar cliente u orden')) throw new Error('buscar');
if (h2.includes('window.print') || h2.includes('.print(')) throw new Error('print');
if (!h2.includes('id="mc-hist-editar" disabled')) throw new Error('editar');
if (!h2.includes('MCPack.ver') || !h2.includes('MCEnt.ver')) throw new Error('modulos');
const mcrow = html.slice(html.indexOf('var MCrow='), html.indexOf('/* b476 REGLA'));

function page(w){
  return `<!doctype html><meta charset="utf-8"><title>hist</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;background:#0b1520;color:#e8eef6;font:14px -apple-system,sans-serif}
.chip{border:1px solid #3a5878;border-radius:8px;padding:6px 10px;background:#111a26;color:#e8eef6}
.cbz-card{border:1px solid #1c2a3a;border-radius:12px;padding:10px;margin:0 0 8px}
.cbz-card-name{font-weight:800}.pmeta{color:#9fb3c8;font-size:12px}.cbz-btn-sec{min-height:36px}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="ventas-screen"></div><div id="result"></div>
<script>
var posts=[],printed=0;window.print=function(){printed=1;};
var rol='admin';
function getProfile(){return {rol:rol,modulos:['~hist.e.actas=1']};}
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function MCcan(k){return k==='hist.e.actas';}
function mcPdfName(){return 'Acta.pdf';}
function MCsaveBlob(){}
function MCPickListPdf(){return Promise.resolve(new Blob(['%PDF']));}
function MCpost(b){posts.push(b.op||b.action);
  if(b.op==='historial_list')return Promise.resolve({ok:true,modulo:b.modulo,limit:50,offset:b.offset||0,filas:[
    {id:'so-1219',numero:'MCOR-SO-001219',fecha:'2026-11-06T20:00:00Z',cliente:'Mina Norte',estado:'Preparada',acta:true,por:'Oswal'},
    {id:'so-1044',numero:'MCOR-SO-001044',fecha:'2026-10-02T15:00:00Z',cliente:'Sur',estado:'Entregada',acta:false}
  ]});
  if(b.op==='acta_datos')return Promise.resolve({ok:true,orden:{id:b.id,numero:'MCOR-SO-001219',cliente:'Mina Norte',ruc:'1799',bodega:'Bodega principal',po:'PO-1',factura:'F001',fecha:'2026-11-06T20:00:00Z'},lineas:[{sku:'MCOR000511',nombre:'WASHER',codigo:'12042040004110M',cantidad:30,bodega:'Bodega principal',sublocation:'11-B-2',por:'Oswal',fecha:'2026-11-06T20:10:00Z'}],cajas:[]});
  return Promise.resolve({ok:false,error:'no'});
}
${mcrow}
${h2}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCHist2.abrir('preparar');
setTimeout(function(){
  var t=document.getElementById('mh2-ov').textContent;
  if(t.indexOf('MCOR-SO-001219')<0||t.indexOf('Mina Norte')<0)return mal('fila');
  if(t.indexOf('Preparada')<0||t.indexOf('PDF')<0)return mal('chip');
  if(t.indexOf('Preparó:')>=0)return mal('apretada');
  var pdfs=document.querySelectorAll('#mh2-ov button');
  var dis=[].filter.call(pdfs,function(b){return b.textContent==='Sin acta'&&b.disabled;});
  if(!dis.length)return mal('sin acta');
  var ov=document.getElementById('mh2-ov');
  ov.style.width='${w}px';ov.style.maxWidth='${w}px';ov.style.right='auto';
  var row=document.querySelector('#mh2-ov .mcrow');
  var box=row.getBoundingClientRect();
  if(box.left<0||box.right>ov.getBoundingClientRect().right+1)return mal('ancho '+box.right);
  var fuera=[].some.call(row.querySelectorAll('.n,.rt,.ln,.chip'),function(k){return k.getBoundingClientRect().right>box.right+2;});
  if(fuera)return mal('rebasa');
  document.getElementById('mh2-q').value='Mina';
  document.getElementById('mh2-q').dispatchEvent(new Event('input',{bubbles:true}));
  setTimeout(function(){
    if(posts.filter(function(p){return p==='historial_list';}).length<2)return mal('buscar');
    document.querySelector('#mh2-ov .mcrow').click();
    setTimeout(function(){
      var v=document.getElementById('ventas-screen').textContent;
      if(v.indexOf('MCOR-SO-001219')<0||v.indexOf('WASHER')<0||v.indexOf('11-B-2')<0)return mal('detalle '+v.slice(0,180));
      if(v.indexOf('Confirmar preparación')>=0)return mal('edita');
      var ed=document.getElementById('mc-hist-editar');
      if(!ed||!ed.disabled)return mal('editar admin');
      rol='usuario';
      MCHist2.reabrir();
      setTimeout(function(){
        document.querySelector('#mh2-ov .mcrow').click();
        setTimeout(function(){
          if(document.getElementById('mc-hist-editar'))return mal('editar usuario');
          if(printed)return mal('print');
          MCHist2.reabrir();
          document.getElementById('result').textContent='OK';
          document.title='OK';
        },40);
      },40);
    },40);
  },400);
},40);
</script>`;
}

const dir='/tmp/historial-actas';
mkdirSync(dir,{recursive:true});
const chrome='/usr/local/bin/google-chrome';
for (const w of [390,1280]){
  const file=join(dir,'ui-'+w+'.html');
  writeFileSync(file,page(w));
  const shot='/opt/cursor/artifacts/historial-actas-'+w+'.png';
  const run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--force-device-scale-factor=1','--user-data-dir=/tmp/chrome-hist'+w,'--window-size='+w+',900','--virtual-time-budget=2500','--screenshot='+shot,'--dump-dom',file],{encoding:'utf8',timeout:20000});
  const dom=(run.stdout||'')+(run.stderr||'');
  if(!dom.includes('>OK<')&&!dom.includes('>OK</div>')){
    const m=dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w+' '+(m?m[1]:'sin resultado '+run.status));
  }
  console.log(w,'OK',shot);
}
