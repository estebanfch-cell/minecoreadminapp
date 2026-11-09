/**
 * Entregar: la tarjeta tiene Enviar orden y Acta de entrega, no la recepción digital.
 *   node tests/entregar-acta.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='619'")) throw new Error('build');
if (!sw.includes("var SWV='b619'")) throw new Error('sw');
if (!html.includes("acta_ticket")) throw new Error('acta ticket');
if (!html.includes("deshacerEnvio")) throw new Error('deshacer');
if (!html.includes("c.fotos.length||c.firma")) throw new Error('evidencia');
const mcrow = html.slice(html.indexOf('var MCrow='), html.indexOf('/* b476 REGLA'));
const ent = html.slice(html.indexOf('var MCEnt=(function(){'), html.indexOf('/* b353 t628:'));
if (ent.includes("prompt('Transportista")) throw new Error('sigue preguntando');

function page(w){
  return `<!doctype html><meta charset="utf-8"><title>ent</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}
#maes-screen,#ent{width:${w}px;max-width:${w}px;box-sizing:border-box}
.chip,.cbz-btn,.cbz-btn-sec{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6}
.cbz-card{border:1px solid #1c2a3a;border-radius:12px}
.tagx{font-size:11px;font-weight:800}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[],cams=0,alerts=[],prompts=0,envios=[];
window.alert=function(m){alerts.push(m);};
window.prompt=function(){prompts++;return null;};
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function getProfile(){return window._P||{rol:'usuario',modulos:['cotizaciones+']};}
function MCcan(k){return k==='pick.e.enviar'&&window._PICK;}
function MCsbGet(){return {t:'tok'};}
function MCerr(e){return String(e&&e.message||e);}function toast(){}
window.MCnom={poner:function(u,n){this._n=n;this._u=u;},quien:function(s){return this._u===s&&this._n?this._n:s;}};
var MCFirmaR={opened:null,_fir:{},boton:function(id){return '<span class="dig" data-id="'+id+'">DIGITAL</span>';},abrir:function(id,num){this.opened=id+'|'+num;}};
window.fetch=function(url,opt){var b=JSON.parse(opt.body);envios.push(b);
  function ok(x){return Promise.resolve({json:function(){return Promise.resolve(x);}});}
  if(String(url).indexOf('ent-envio')<0)return ok({ok:false});
  if(b.op==='estado')return ok({ok:true,ordenes:(b.ids||[]).map(function(id){return {id:id,acta:String(id).indexOf('1288')>=0,por:'EFCH',nombre:'Esteban Ferlito',at:'09/11/2026 14:32 (EC)',deshacer:false};})});
  if(b.op==='marcar')return ok({ok:true,enviada:true,por:'EFCH',nombre:'Esteban Ferlito',at:'09/11/2026 14:40 (EC)',deshacer:true});
  if(b.op==='deshacer')return ok({ok:true,enviada:false,deshacer:false});
  return ok({ok:false,error:'no'});
};
function MCpost(b){posts.push(JSON.parse(JSON.stringify(b)));
  if(b.op==='ent_list')return Promise.resolve({ok:true,ordenes:[
    {id:'so-1291',order_number:'MCOR-SO-001291',cliente:'ROCKEXPLORE S.A.S',lineas:1,ship_estado:window._ENV?'enviado':'empacada'},
    {id:'so-env',order_number:'MCOR-SO-001300',cliente:'SIN ACTA',lineas:1,ship_estado:'enviado'},
    {id:'11111111-1111-4111-8111-111111111288',order_number:'MCOR-SO-001288',cliente:'SULTANA DEL CONDOR MINERA S.A',lineas:1,ship_estado:'enviado'}
  ],entregadas:[{id:'so-1209',order_number:'MCOR-SO-001209',cliente:'ROCKEXPLORE S.A.S',receptor:'Gabriel Cabrera',entregado_at:'2026-11-04'}]});
  if(b.op==='ent_get'){
    if(b.id==='so-1209')return Promise.resolve({ok:true,orden:{id:b.id,order_number:'MCOR-SO-001209',cliente:'ROCKEXPLORE S.A.S'},lineas:[{nombre:'ITEM',sku:'MCOR1',cantidad:1}],fotos:[{id:1,url:'#',tipo:'paquete',ts:'10:00',nombre:'foto.jpg'}],entrega:{receptor:'Gabriel Cabrera',firma_url:'#firma',firma_ts:'10:01'}});
    return Promise.resolve({ok:true,orden:{id:b.id,order_number:'MCOR-SO-001291',cliente:'ROCKEXPLORE S.A.S'},lineas:[{nombre:'ITEM',sku:'MCOR1',cantidad:1}],fotos:[],entrega:null});
  }
  if(b.op==='ship')return Promise.resolve({ok:true});
  return Promise.resolve({ok:false,error:'no'});
}
var _click=HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click=function(){if(this.id==='ent-cam')cams++;return _click.apply(this,arguments);};
${mcrow}
var MCDocs={attr:function(){return '';}};
${ent}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCEnt.init();
setTimeout(function(){
  var box=document.getElementById('ent');
  var card=box.querySelector('.mcrow');
  var t=card.textContent;
  if(t.indexOf('DIGITAL')>=0||t.indexOf('Enviar recepción digital')>=0)return mal('digital en lista');
  if(t.indexOf('Enviar orden')<0||t.indexOf('Acta de entrega')<0)return mal('botones');
  if(card.querySelector('.ent-st').textContent!=='Acta pendiente ✗')return mal('pendiente');
  var sin=document.querySelector('[data-ent="so-env"]');
  if(!sin||sin.textContent.indexOf('✓ Enviada')<0||sin.textContent.indexOf('Acta pendiente ✗')<0)return mal('enviada sin acta');
  if(sin.querySelector('.ent-acta').textContent.indexOf('✓')===0)return mal('check de mas');
  var con=document.querySelector('[data-ent="11111111-1111-4111-8111-111111111288"]');
  if(!con||con.textContent.indexOf('Acta recibida ✓')<0||con.textContent.indexOf('Esteban Ferlito')<0||con.textContent.indexOf('09/11/2026 14:32')<0)return mal('ticket '+(con&&con.textContent));
  var pend=document.querySelector('[data-ent="so-1291"]'),entg=document.querySelector('[data-ent="so-1209"]');
  if((pend.getAttribute('onclick')||'').indexOf("MCEnt.abrir('so-1291')")<0)return mal('tap pendiente');
  if((entg.getAttribute('onclick')||'').indexOf("MCEnt.abrir('so-1209')")<0)return mal('tap entregada');
  if(pend.hasAttribute('data-mcdocs-id')||entg.hasAttribute('data-mcdocs-id'))return mal('abre pdf');
  MCFirmaR._fir['so-env']=true;MCEnt.syncFirma();
  if(document.querySelector('[data-ent="so-env"] .ent-st').textContent!=='Acta recibida ✓')return mal('sync');
  if(document.querySelector('[data-ent="so-env"] .ent-acta').textContent.indexOf('✓')!==0)return mal('sync acta');
  delete MCFirmaR._fir['so-env'];MCEnt.syncFirma();
  if(document.querySelector('[data-ent="so-env"] .ent-st').textContent!=='Acta pendiente ✗')return mal('sync off');
  var rec=document.querySelector('[data-ent="so-1209"]');
  if(!rec||rec.textContent.indexOf('Acta recibida ✓')<0||rec.textContent.indexOf('✓ Enviada')<0||rec.textContent.indexOf('✓ Acta de entrega')<0)return mal('recibida');
  var acc=card.querySelectorAll('.ent-act');
  var borde=box.getBoundingClientRect().right,izq=box.getBoundingClientRect().left;
  var piezas=[].slice.call(box.querySelectorAll('.ent-act,.ent-st'));
  if([].some.call(piezas,function(b){var r=b.getBoundingClientRect();return r.right>borde+1||r.left<izq-1;}))return mal('ancho');
  acc[1].click();
  var mn=document.getElementById('ent-mn');
  if(!mn)return mal('menu');
  var ops=[].map.call(mn.querySelectorAll('button'),function(b){return b.textContent;});
  if(ops.join('|')!=='Firma en persona|Firma remota (enlace)|Foto|Ticket / guía|Foto + firma')return mal('opciones '+ops.join('|'));
  if(mn.getBoundingClientRect().right>window.innerWidth-4)return mal('menu fuera');
  mn.querySelectorAll('button')[1].click();
  if(MCFirmaR.opened!=='so-1291|MCOR-SO-001291')return mal('remota '+MCFirmaR.opened);
  if(posts.some(function(p){return p.op==='ship'||p.op==='ent_save';}))return mal('remota envio');
  document.querySelector('.ent-act').click();
  setTimeout(function(){
    if(prompts)return mal('pregunto');
    var sh=envios.filter(function(p){return p.op==='marcar';});
    if(sh.length!==1||sh[0].id!=='so-1291'||sh[0].transportista||sh[0].guia)return mal('ship');
    if(posts.some(function(p){return p.op==='ship'||p.op==='ent_save'||p.op==='ent_firma';}))return mal('entrego');
    if(posts.filter(function(p){return p.op==='ent_list';}).length!==1)return mal('recargo');
    var card2=document.querySelector('[data-ent="so-1291"]');
    var envb=card2.querySelector('.ent-env');
    if(!envb||!envb.disabled||envb.textContent!=='✓ Enviada')return mal('marca '+(envb&&envb.textContent));
    if(card2.textContent.indexOf('Esteban Ferlito')<0||card2.textContent.indexOf('09/11/2026 14:40')<0)return mal('quien');
    if(!card2.querySelector('.ent-des'))return mal('sin deshacer');
    card2.querySelector('.ent-des').click();
    setTimeout(function(){
      var d=envios.filter(function(p){return p.op==='deshacer';});
      if(d.length!==1||d[0].id!=='so-1291')return mal('deshacer');
      var back=document.querySelector('[data-ent="so-1291"] .ent-env');
      if(!back||back.disabled||back.textContent!=='Enviar orden')return mal('vuelve '+(back&&back.textContent));
    window._P={rol:'usuario',modulos:[]};window._PICK=false;window._ENV=false;posts=[];
    MCEnt.init();
    setTimeout(function(){
      if(document.getElementById('ent').textContent.indexOf('Enviar orden')>=0)return mal('sin permiso');
      document.querySelector('.mcrow .ln').click();
      setTimeout(function(){
        if(!posts.some(function(p){return p.op==='ent_get';}))return mal('no abre');
        if(document.getElementById('ent').textContent.indexOf('DIGITAL')<0)return mal('dentro');
        if(document.getElementById('ent').textContent.indexOf('foto o pide la firma')<0&&document.getElementById('ent').textContent.indexOf('una</b> evidencia')<0&&document.getElementById('ent').innerHTML.indexOf('una</b> evidencia')<0)return mal('regla');
        cams=0;MCEnt.irActa('so-1291','ticket');
        setTimeout(function(){
          var on=[].filter.call(document.querySelectorAll('.up-bar .chip'),function(b){return b.getAttribute('style')&&b.getAttribute('style').indexOf('E8FF00')>=0;})[0];
          if(!on||on.textContent.indexOf('Ticket')<0)return mal('tipo '+(on&&on.textContent));
          if(!cams)return mal('camara');
          MCEnt.abrir('so-1209');
          setTimeout(function(){
            if(!posts.some(function(p){return p.op==='ent_get'&&p.id==='so-1209';}))return mal('get entregada');
            var d=document.getElementById('ent');
            var tx=d.textContent;
            if(tx.indexOf('DIGITAL')<0)return mal('digital entregada');
            var recIn=document.getElementById('ent-rec');
            if(!recIn||recIn.value!=='Gabriel Cabrera')return mal('receptor');
            if(tx.indexOf('Ver acta de entrega')<0)return mal('acta');
            if(!d.querySelector('.e-ph img'))return mal('foto');
            document.getElementById('result').textContent='OK';
            document.title='OK';
          },40);
        },80);
      },40);
    },40);
    },30);
  },20);
},40);
</script>`;
}

const dir = '/tmp/entregar-acta';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [320, 375, 390, 430, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const shot = w === 390 ? ['--screenshot=/opt/cursor/artifacts/entregar-acta-390.png'] : [];
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-ent-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=4000', ...shot, '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
