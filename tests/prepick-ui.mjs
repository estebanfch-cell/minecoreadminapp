/**
 * Pre-preparar a 390 px. No pulsa Guardar ni Dividir. No abre el portal con sesión.
 *   node tests/prepick-ui.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='599'")) throw new Error('build');
if (!sw.includes("var SWV='b599'")) throw new Error('sw');
if (!html.includes("op:'prepick_costeos'")) throw new Error('costeos');
if (!html.includes('type="button" class="chip" onclick="Ventas.prepickBuscar()"')) throw new Error('buscar');
if (!html.includes('onkeyup=')) throw new Error('ir');
if (!html.includes('Sin resultados: ninguna OV abierta se cubre con este packing.')) throw new Error('vacio');
if (!html.includes('Respuesta inesperada del servidor')) throw new Error('inesperada');
if (!html.includes('pkp.lista.length===1')) throw new Error('auto');
if (html.includes('El packing de ese costeo, más el stock')) throw new Error('texto inicial');

const nums = ['001044-7-1', '001219', '001231-4', '001232-3', '001285-2', '001288'];
const page = `<!doctype html><meta charset="utf-8"><title>prepick</title>
<style>
html,body{width:390px;max-width:390px;margin:0;background:#0b1520;color:#e8eef6;font:14px/1.35 -apple-system,sans-serif}
.cbz-card{border:1px solid #1c2a3a;border-radius:12px;padding:10px;margin:0 0 8px}
.cbz-btn{background:#a3e635;color:#0b1520;border:0;border-radius:8px;padding:8px 12px;font-weight:700}
.chip{background:#1c2a3a;color:#e8eef6;border:0;border-radius:8px;padding:8px 10px}
.cbz-search{background:#0f1720;color:#fff;border:1px solid #2a3d52;border-radius:8px;padding:8px}
.cbz-muted{color:#8fa3b8}.cbz-error{color:#ff8a8a}.cbz-loading{color:#9fb3c8}
#result{position:absolute;left:-9999px}
</style>
<div id="app"></div><div id="result"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function chip(t,c){return '<span style="border:1px solid '+c+';color:'+c+';border-radius:10px;padding:1px 8px;font-size:12px">'+t+'</span>';}
function el(){return document.getElementById('app');}
function MCcan(){return true;}
var pkp={codigo:'',data:null,lista:[]};
var posts=[];
function api(p){posts.push(p.op);if(p.op==='prepick_costeos')return Promise.resolve({ok:true,costeos:[{codigo:'MCOR-02.3.5.13',por_recibir:40},{codigo:'MCOR-02.3.5.12',por_recibir:3}]});
  if(p.op==='prepick_list'){var c=String(p.codigo||'');if(c!=='MCOR-02.3.5.13'&&c!=='02.3.5.13')return Promise.resolve({ok:true,tipo:'prepick',ovs:[]});
    return Promise.resolve({ok:true,tipo:'prepick',ovs:${JSON.stringify(nums.map((n)=>({id:'id'+n,num:'MCOR-SO-'+n,cliente:'Cliente',clase:'completa',lineas:[{sku:'MCOR000100',nombre:'Pieza',de_stock:1,de_pack:1,falta:0}]})))}});}
  return Promise.resolve({ok:false,error:'no'});}
${html.slice(html.indexOf('function prepickUds('), html.indexOf('function prepickGuardar()'))}
window.Ventas={prepick:prepick,prepickBuscar:prepickBuscar,prepickElegir:prepickElegir,initPick:function(){}};
prepick();
setTimeout(function(){
  var chip13=[].find.call(document.querySelectorAll('#pkp-chips button'),function(b){return b.getAttribute('data-c')==='MCOR-02.3.5.13';});
  chip13.click();
  setTimeout(function(){
    document.getElementById('pkp-c').value='02.3.5.13';
    document.querySelector('button[onclick="Ventas.prepickBuscar()"]').click();
    setTimeout(function(){
      var t=document.getElementById('pkp-res').textContent;
      var bad=[];
      ${JSON.stringify(nums)}.forEach(function(n){if(t.indexOf(n)<0)bad.push('falta '+n);});
      if((t.match(/Completa/g)||[]).length<6)bad.push('completas');
      if(/Dividir/.test(t))bad.push('dividió');
      if(posts.indexOf('prepick_reservar')>=0)bad.push('guardó');
      if(/Cargando costeos/.test(document.getElementById('pkp-res').textContent))bad.push('texto inicial');
      document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
      document.title=document.getElementById('result').textContent;
    },40);
  },40);
},40);
</script>`;
const dir = '/tmp/prepick-ui';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'ui.html'), page);
const chrome = '/usr/local/bin/google-chrome';
const shot = '/opt/cursor/artifacts/prepick-584-390.png';
const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-pkp584', '--window-size=390,900', '--virtual-time-budget=2500', '--screenshot=' + shot, '--dump-dom', join(dir, 'ui.html')], { encoding: 'utf8', timeout: 20000 });
const dom = (run.stdout || '') + (run.stderr || '');
if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  throw new Error(m ? m[1] : 'sin resultado ' + run.status);
}
console.log('390 OK', shot);
