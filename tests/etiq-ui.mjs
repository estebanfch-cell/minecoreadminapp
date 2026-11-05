/**
 * UI de etiquetas con DATOS DE PRUEBA, a 390 px y 1280 px.
 * No abre el portal real ni una orden real.
 *   node tests/etiq-ui.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const panel = readFileSync(join(root, 'etiq/panel.js'), 'utf8');
const outDir = process.env.ETIQ_SHOTS || '/tmp/etiq-shots';
mkdirSync(outDir, { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });

const page = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>etiq</title>
<style>
*{box-sizing:border-box}html,body{margin:0;background:#0b1219;color:#dce6f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
.banner{background:#3a2e00;color:#f0c040;font-weight:800;padding:8px 12px;font-size:13px}
.wrap{padding:12px;max-width:720px}
.cbz-card{background:#0f1a26;border:1px solid #1c2a3a;border-radius:10px;padding:10px 12px;margin:8px 0}
.cbz-btn{background:#1e4976;border:0;color:#fff;border-radius:8px;padding:8px 12px;font-size:14px;cursor:pointer}
.chip{background:#0f1720;border:1px solid #223142;border-radius:20px;color:#dce6f0;padding:8px 12px;font-size:13px;cursor:pointer}
.pq-bar{position:sticky;bottom:0;background:#0b1622;padding:10px 0;display:flex;gap:8px;flex-wrap:wrap;z-index:5}
.pg-sens{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.usw{appearance:none;-webkit-appearance:none;width:32px;height:18px;border-radius:10px;background:#3a4a5c;position:relative}
.flag{font-size:12px;color:#8fa3b8}
#result{font-size:12px;padding:8px 12px}
</style>
<div class="banner">DATOS DE PRUEBA · no es una orden real · no se envió nada a una impresora</div>
<div class="wrap" id="prep"></div>
<div class="wrap" id="gallery"></div>
<div id="result"></div>
<script>${panel}</script>
<script>
getProfile=function(){return {nombre:'USUARIO_PRUEBA',rol:'usuario',modulos:['inventario','~prep.e.etiq=1']};};
var orden={id:'ov-prueba-1',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',lineas:[{sku:'PRUEBA-SKU',nombre:'PRODUCTO DE PRUEBA',cantidad:2,item_type:'product'}]};
document.getElementById('prep').innerHTML=
  '<div class="cbz-card"><b>Preparar orden</b><div class="flag">PRUEBA-SO-0001 · CLIENTE DE PRUEBA</div></div>'+
  MCEtiq.panel(orden,'prep')+
  '<div class="pq-bar" id="bar"><button class="cbz-btn" id="confirm" type="button">Confirmar preparación (0)</button></div>'+
  '<div class="cbz-card" id="users"><b>Usuarios · USUARIO_PRUEBA</b><div class="pg-sens"><label class="flag"><input class="usw" id="sw" type="checkbox"> Imprimir etiquetas clientes (DYMO Wireless)</label><span class="flag">Apagado por defecto. Este interruptor de prueba está apagado.</span></div></div>';
document.getElementById('gallery').innerHTML=
  '<h3 class="flag">Estados de la interfaz (no son trabajos reales)</h3>'+
  MCEtiq.boxHtml({state:'puente_desconectado',id:'ov-prueba-1',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',job_id:'job-prueba'})+
  MCEtiq.boxHtml({state:'impresora_offline',id:'ov-prueba-2',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',job_id:'job-prueba'})+
  MCEtiq.boxHtml({state:'error_envio',id:'ov-prueba-3',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',job_id:'job-prueba'})+
  MCEtiq.boxHtml({state:'aceptado_cups',id:'ov-prueba-4',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',cups_job_id:'Wireless-PRUEBA-88'})+
  MCEtiq.boxHtml({state:'ambiguo',id:'ov-prueba-5',order_number:'PRUEBA-SO-0001',cliente:'CLIENTE DE PRUEBA',job_id:'job-prueba'});
var live=document.querySelector('.etiq-box button.cbz-btn');
document.getElementById('result').textContent='PEND';
live.click();
function overlap(a,b){return !(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);}
function check(){
  var bad=[];
  var vw=document.documentElement.clientWidth;
  document.querySelectorAll('.etiq-box,.etiq-acts button,.cbz-btn,.chip').forEach(function(el){
    var r=el.getBoundingClientRect();
    if(r.width>vw+1)bad.push('ancho '+el.className);
    if(el.scrollWidth>el.clientWidth+2&&el.clientWidth>0)bad.push('recorte '+el.textContent.slice(0,24));
  });
  var bar=document.getElementById('bar').getBoundingClientRect();
  var btn=document.querySelector('.etiq-box .cbz-btn').getBoundingClientRect();
  if(overlap(bar,btn))bad.push('solape barra');
  var st=document.querySelector('.etiq-st').textContent;
  if(!/No se envió ningún trabajo/.test(st))bad.push('estado '+st);
  if(/impresa con éxito|impreso físicamente/i.test(document.body.innerText))bad.push('texto engañoso');
  if(document.getElementById('sw').checked)bad.push('permiso encendido');
  document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
  document.title=bad.length?('FAIL '+bad.join(' | ')):'OK';
}
setTimeout(check, 40);
</script>`;

const htmlPath = join(outDir, 'etiq-ui.html');
writeFileSync(htmlPath, page);
const chrome = '/usr/local/bin/google-chrome';

function chromeArgs(extra) {
  return ['--signal=KILL', '12', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-etiq-' + Math.random().toString(16).slice(2)].concat(extra);
}
function shot(w, h, name) {
  const png = join('/opt/cursor/artifacts', name);
  spawnSync('timeout', chromeArgs(['--timeout=4000', '--window-size=' + w + ',' + h, '--screenshot=' + png, 'file://' + htmlPath]), { encoding: 'utf8' });
  const dump = spawnSync('timeout', chromeArgs(['--timeout=4000', '--window-size=' + w + ',' + h, '--virtual-time-budget=1500', '--dump-dom', 'file://' + htmlPath]), { encoding: 'utf8' });
  const dom = dump.stdout || '';
  const mark = (dom.match(/<div id="result">([^<]*)</) || [])[1] || '';
  if (mark !== 'OK') {
    console.error(dom.slice(-1200));
    throw new Error('layout ' + w + ' ' + mark);
  }
  console.log(name, 'OK');
}

shot(390, 2800, 'etiq-390.png');
shot(1280, 1400, 'etiq-1280.png');
