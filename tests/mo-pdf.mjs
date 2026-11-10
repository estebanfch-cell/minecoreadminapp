/**
 * Imprimir de la orden de manufactura carga el PDF Minecore (logo, fotos, costos)
 * y el dinero de la orden se ve con 2 decimales. 390 y escritorio.
 *   node tests/mo-pdf.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='627'")) throw new Error('build');
if (!sw.includes("var SWV='b627'")) throw new Error('sw');
if (html.includes("alert('PDF no disponible')")) throw new Error('sigue el aviso sin cargar jsPDF');

const manu = html.indexOf('var Manuf=(function()');
const money = html.slice(html.indexOf('function money(n,d){var x=parseFloat', manu), html.indexOf('function num(n)', manu));
const pdfAt = html.indexOf('function pdf(){if(!cur||!cur.orden)return;', manu);
const pdf = html.slice(pdfAt, html.indexOf('/* ---------- b242:', pdfAt));
if (!pdf.includes("MCInflowDoc('mo'")) throw new Error('no usa el PDF Minecore');
if (!pdf.includes('mcArmPdfTab')) throw new Error('iPhone sin pestaña armada');
if (!pdf.includes('mcDownloadBlob')) throw new Error('sin descarga');
if (pdf.includes('window.jspdf') || pdf.includes('PDF no disponible')) throw new Error('sigue el corte sincrónico');
if (!html.includes("else if(kind==='mo')") || !html.includes("letterhead('ORDEN DE MANUFACTURA'")) throw new Error('sin membrete');
if (!html.includes("kind==='mo'&&d.img")) throw new Error('sin foto del terminado');
new Function(money);
new Function(pdf);
new Function(html.slice(html.indexOf('function MCInflowDoc'), html.indexOf('var MC_DOC_BRANDS')));

const jspdfPath = '/tmp/jspdf.umd.min.js';
if (!existsSync(jspdfPath)) {
  const dl = spawnSync('curl', ['-fsSL', '-o', jspdfPath, 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'], { encoding: 'utf8', timeout: 30000 });
  if (dl.status !== 0) throw new Error('no se pudo cargar jspdf para la prueba');
}
const jspdf = readFileSync(jspdfPath, 'utf8');
const logo = html.slice(html.indexOf('var MC_PICK_LOGO='), html.indexOf('var MC_C128='));
const c128 = html.slice(html.indexOf('var MC_C128='), html.indexOf('function mcCode128'));
const code128 = html.slice(html.indexOf('function mcCode128'), html.indexOf('function mcPickAsset'));
const docFn = html.slice(html.indexOf('function MCInflowDoc'), html.indexOf('var MC_DOC_BRANDS'));

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>mo</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}
#card{box-sizing:border-box;width:${w}px;padding:8px}
.row{display:flex;flex-wrap:wrap;gap:6px}
.chip{min-height:44px;padding:0 14px;border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;font-size:12.5px}
.crow{display:flex;gap:8px;align-items:center;padding:6px 0}
.crow span{min-width:0}
#result{padding:8px;color:#b7f34a;font-size:12px;word-break:break-word}</style>
<div id="card">
  <div class="row"><button class="chip" id="imp" type="button">🖨 Imprimir</button></div>
  <div class="grid"><div>Componentes<br><b id="comp"></b></div><div>Costo unitario<br><b id="unit"></b></div><div>Línea<br><b id="line"></b></div></div>
  <div class="crow" id="crow"><div style="width:36px;height:36px;background:#fff;border-radius:6px;flex:none"></div><span>SEAL · <b id="uc"></b></span></div>
  <div id="name">MCOR001184 · HO/PO NGII DRY HOLE VALVE KIT · 3 und.</div>
</div>
<div id="result">WAIT</div>
<script>
${jspdf}
${logo}
${c128}
${code128}
function mcRound(v){var x=+v||0;var a=Number(Math.abs(x).toPrecision(15));var r=Math.floor(a+0.5);return x<0?-r:r;}
function mcPickFecha(f){f=String(f||'').slice(0,10);var p=f.split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:f;}
function mcEan13(){return null;}
function mcPickFonts(){return Promise.resolve(null);}
var PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function mcLoadImg(src){return Promise.resolve(src?PNG:null);}
${money}
${docFn}
var Real=window.jspdf.jsPDF;
var texts=[],imgs=0,formats=[];
function Js(opt){formats.push(opt&&opt.format);var doc=new Real(opt);var t=doc.text.bind(doc),ai=doc.addImage.bind(doc),out=doc.output.bind(doc);
  doc.text=function(s){texts.push(Array.isArray(s)?s.join('\\n'):String(s));return t.apply(doc,arguments);};
  doc.addImage=function(){var r=ai.apply(doc,arguments);imgs++;return r;};
  doc.output=function(type){if(type==='blob'){var ab=out('arraybuffer'),u=new Uint8Array(ab),s='';for(var i=0;i<5&&i<u.length;i++)s+=String.fromCharCode(u[i]);if(!got)got={};got.head=s;got.bytes=u.length;return new Blob([ab],{type:'application/pdf'});}return out.apply(doc,arguments);};
  return doc;}
function loadJsPDF(){return Promise.resolve(Js);}
var EST={abierta:['Abierta','#5cc8ff'],completada:['Completada','#6fd68f']};
var cur={orden:{mo_number:'MO-000076',estado:'completada',quantity:3,order_date:'2026-10-01',completed_date:'2026-10-20',due_date:'2026-10-18',bodega:'BODEGA PRINCIPAL',put_sublocation:'A-1',unit_cost:81.8323,cost_components:0.6364,cost_extra:1.5,cost_labor:0,remarks:'Kit seco',extra_costs:[{name:'Maquinado',cost:1.5}]},
  producto:{sku:'MCOR001184',name:'HO/PO NGII DRY HOLE VALVE KIT',img:'prod'},
  lineas:[{quantity:3,prod:{sku:'MCOR009999',name:'SEAL RING',codigo:'SEL-1',img:'comp',costo:0.6364}}],
  costoEstimado:{unitario:12.349,componentes:1.2,extra:0,mano_obra:0}};
var stored=cur.orden.unit_cost;
var armed=0,got=null,alerts=[];
function mcArmPdfTab(){armed++;return {closed:false};}
function mcClosePdfTab_(){}
function mcPdfName(t,n){return 'Orden de fabricación '+n+'.pdf';}
function mcDownloadBlob(b,name,mime,slot){var head=got&&got.head;got={name:name,slot:!!slot,size:b.size,head:head||'',bytes:got&&got.bytes};return Promise.resolve();}
window.alert=function(m){alerts.push(String(m));};
${pdf}
document.getElementById('unit').textContent=money(cur.orden.unit_cost,4);
document.getElementById('comp').textContent=money(cur.orden.cost_components,4);
document.getElementById('line').textContent=money(0.6364*3);
document.getElementById('uc').textContent=money(0.6364,4);
document.getElementById('imp').onclick=function(){return pdf();};
Promise.resolve(document.getElementById('imp').onclick()).then(function(){
  return MCInflowDoc('mo',{num:'MO-000099',fecha:'2026-11-01',estado:'Abierta',cantidad:1,producto:'PIEZA',sku:'MCOR1',bodega:'BODEGA',lineas:[{nombre:'TORNILLO',sku:'T1',cantidad:2,precio:1.239,subtotal:2.478,img:'c'}],componentes:1.2,extra:0,mano:0,unitario:12.349});
}).then(function(){
    var card=document.getElementById('card');
    var all=texts.join('\\n');
    var chip=document.getElementById('imp');
    var ok=document.getElementById('unit').textContent==='$81.83'
      &&document.getElementById('comp').textContent==='$0.64'
      &&document.getElementById('uc').textContent==='$0.64'
      &&card.textContent.indexOf('81.8323')<0
      &&card.textContent.indexOf('0.6364')<0
      &&stored===81.8323
      &&armed===1&&got&&got.slot&&got.head==='%PDF-'&&got.size>20000
      &&got.name.indexOf('MO-000076')>=0
      &&formats.indexOf('a4')>=0&&imgs>=3
      &&all.indexOf('ORDEN DE MANUFACTURA')>=0
      &&all.indexOf('MO-000076')>=0&&all.indexOf('MCOR001184')>=0
      &&all.indexOf('SEAL RING')>=0&&all.indexOf('$81.83')>=0&&all.indexOf('$0.64')>=0
      &&all.indexOf('$1.91')>=0&&all.indexOf('COMPONENTES')>=0
      &&all.indexOf('MO-000099')>=0&&all.indexOf('$12.35')>=0&&all.indexOf('$1.24')>=0
      &&alerts.length===0
      &&card.scrollWidth<=card.clientWidth+2
      &&parseFloat(getComputedStyle(chip).minHeight)>=44;
    document.getElementById('result').textContent=ok?'OK':('FAIL unit='+document.getElementById('unit').textContent+' comp='+document.getElementById('comp').textContent+' got='+JSON.stringify(got)+' imgs='+imgs+' fmt='+formats.join(',')+' alerts='+alerts.join('|')+' sw='+card.scrollWidth+'/'+card.clientWidth+' txt='+all.slice(0,500));
    document.title=document.getElementById('result').textContent.slice(0,80);
  }).catch(function(e){document.getElementById('result').textContent='FAIL '+(e&&e.message||e);document.title='FAIL';});
</script>`;
}

const dir = '/tmp/mo-pdf';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=/tmp/chrome-mo-${w}`, `--window-size=${w},900`, '--virtual-time-budget=6000', '--dump-dom', file], { encoding: 'utf8', timeout: 40000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  const title = (out.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  if (!out.includes('>OK<') && title !== 'OK') {
    const res = (out.match(/id="result">([^<]*)</) || [])[1] || out.slice(-1500);
    throw new Error(w + ' ' + res);
  }
  console.log(w, 'OK');
}
console.log('mo-pdf ok');
