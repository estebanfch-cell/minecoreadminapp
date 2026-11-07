/**
 * Roles de pago: empleado, admin, contabilidad en solo lectura y PDF A4.
 *   node tests/roles-pago.mjs
 */
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='603'")) throw new Error('build');
if (!sw.includes("var SWV='b603'")) throw new Error('sw');
if (!html.includes("'Personal'")) throw new Error('menu');
if (!html.includes("b('roles','Roles de pago')")) throw new Error('pestana roles');
if (!html.includes('W.permisos')) throw new Error('permisos');
if (!html.includes('dias_laborables')) throw new Error('dias');
if (!html.includes('MCRoles.puede()')) throw new Error('whoami');
const lect = html.slice(html.indexOf('var MC_SB_LECT2'), html.indexOf('var MC_SB_LECT2') + 900);
for (const op of ['rp_whoami', 'rp_mis_roles', 'rp_rol_get', 'rp_preview', 'rp_docs_list']) {
  if (!lect.includes(op)) throw new Error('lectura ' + op);
}
for (const op of ['rp_generar', 'rp_cerrar', 'rp_empleado_save', 'rp_firmar', 'rp_no_firmar', 'rp_doc_registrar']) {
  if (lect.includes(op)) throw new Error('escritura en lectura ' + op);
}
const mod = html.slice(html.indexOf('var MCRoles='), html.indexOf('/* b597-rp-fin */'));
if (!mod.includes('usd(rol.neto)') || !mod.includes('usd(rol.total_ingresos)')) throw new Error('totales');
if (!mod.includes("doc.addImage(firma,'PNG'")) throw new Error('firma en pdf');
if (!mod.includes('copyPages') || !mod.includes('Adjuntar pago') || !mod.includes('Mis préstamos y anticipos')) throw new Error('prepago');
if (!mod.includes('comprobante_view_url') || !mod.includes('class="rp-cv"')) throw new Error('visor');
const pagoDe = mod.slice(mod.indexOf('function pagoDe'), mod.indexOf('function pagoHtml'));
if (pagoDe.includes('comprobante_view_url')) throw new Error('el visor no va al pdf del rol');
const fit = vm.runInNewContext(mod.slice(mod.indexOf('function fitA4('), mod.indexOf('function loadPdfLib()')) + '\nfitA4(2000,1000);');
if (Math.abs(fit.w - (595.28 - 72)) > 0.2 || Math.abs(fit.x - 36) > 0.2) throw new Error('fitA4 ' + JSON.stringify(fit));
if (mod.includes('MC_EC_LOGO')) throw new Error('logo');

const ROL = `{
  id:'r1', periodo:'2026-10', mes:'OCTUBRE 2026',
  del:{desde:'2026-10-01',hasta:'2026-10-31'}, dias:31,
  empleado:{nombre_completo:'HIDALGO IZA LOURDES PIEDAD',cedula:'1709456055',cargo:'Asistente',fecha_ingreso:'2020-01-15',ciudad:'Quito'},
  empleador:{nombre:'ESTEBAN FERLITO',ruc:'1793194965001'},
  ingresos:[{etiqueta:'Sueldo',valor:600},{etiqueta:'Alimentación',valor:0},{etiqueta:'Décimo 13er Sueldo',valor:50},{etiqueta:'Décimo 14to Sueldo',valor:40.17},{etiqueta:'Horas extras',valor:49.98}],
  reembolsos:[{etiqueta:'Reembolso',valor:120.5,detalle:'detalle interno'}],
  egresos:[{etiqueta:'Aporte Personal',valor:56.7},{etiqueta:'Préstamo Quirografario',valor:72.07,cuota:'10/10'}],
  total_ingresos:820.15, total_reembolsos:120.5, total_egresos:428.77, neto:391.38,
  iess_patronal:72.9, costo_empleador:900,
  rutas:{n:12,km:340,desde:'2026-09-26',hasta:'2026-10-25'},
  faltan:['firma'], estado:'provisional'
}`;

function page(w, modo) {
  return `<!doctype html><meta charset="utf-8"><title>rp</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}
#maes-screen{width:${w}px;max-width:${w}px;box-sizing:border-box}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
window.onerror=function(m){var r=document.getElementById('result');if(r)r.textContent='ERR '+m;document.title='FAIL';};
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function getProfile(){return {rol:'usuario',nombre:'EFCH',modulos:[]};}
function renderHome(){}function MCNav(){}MCNav.render=function(){};
var MCnom={nom:function(s){return {EFCH:'Esteban Ferlito',Oswal:'Oswaldo Peña'}[s]||s;},quien:function(s){return s;}};
function MCusr(){return Promise.resolve({ok:true,usuarios:[{nombre:'EFCH',nombreCompleto:'Esteban Ferlito'},{nombre:'Oswal',nombreCompleto:'Oswaldo Peña'}]});}
window._posts=[];window._open=[];window._dl=[];
window.open=function(u){window._open.push(u);};
window.mcDownloadBlob=function(b,n){window._dl.push(n);};
function MCpost(b){window._posts.push(JSON.parse(JSON.stringify(b)));
  if(b.op==='rp_whoami')return Promise.resolve(${modo === 'conta' ? '{ok:true,admin:false,conta:true,ver:false,permisos:false,empleado_id:""}' : modo === 'off' ? '{ok:true,admin:false,conta:false,ver:false,permisos:false}' : modo === 'emp' ? '{ok:true,admin:false,conta:false,ver:true,permisos:false,empleado_id:"e1"}' : modo === 'perm' ? '{ok:true,admin:true,conta:false,ver:false,permisos:true,empleado_id:"e1"}' : '{ok:true,admin:true,conta:false,ver:true,permisos:false,empleado_id:"e1"}'});
  if(b.op==='rp_mis_roles')return Promise.resolve({ok:true,roles:[{id:'r1',periodo:'2026-10',estado:'cerrado',firma_estado:window._fe||'pendiente',pagado:true,neto:391.38,total_ingresos:820.15,total_egresos:428.77,total_reembolsos:120.5,firmado_at:window._fe==='firmado'?'2026-11-02T15:00:00Z':null}]});
  if(b.op==='rp_prestamo_list')return Promise.resolve({ok:true,prestamos:[{id:'p1',tipo:'anticipo',saldo:80,justificacion:'Viaje',comprobante_view_url:'https://example.test/comp.png',descuentos:[{periodo:'2026-11',monto:20}]}]});
  if(b.op==='rp_preview'){var r=${ROL};return Promise.resolve({ok:true,rol:r});}
  if(b.op==='rp_rol_get'){var g=${ROL};g.estado='cerrado';g.firma_estado=window._fe||'pendiente';if(g.firma_estado==='firmado'){g.firmado_at='2026-11-02T15:00:00Z';g.firmado_nombre='EFCH';g.firma_url='data:image/png;base64,'+(window._fb||'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');g.recibido_nombre='EFCH';}return Promise.resolve({ok:true,rol:g});}
  if(b.op==='rp_no_firmar'){window._fe='no_firmado';return Promise.resolve({ok:true});}
  if(b.op==='rp_firmar'){if(!b.firma_png_base64)return Promise.resolve({ok:false,error:'sin firma'});window._fe='firmado';window._fb=b.firma_png_base64;return Promise.resolve({ok:true,firma_estado:'firmado',firmado_at:'2026-11-02T15:00:00Z',firma_url:'data:image/png;base64,'+b.firma_png_base64});}
  if(b.op==='rp_empleados_list')return Promise.resolve({ok:true,empleados:[{id:'e1',nombre_completo:'HIDALGO IZA LOURDES PIEDAD',cedula:'1709456055',cargo:'Asistente',sueldo:600,roles:[{id:'r1',periodo:'2026-10',estado:'provisional',faltan:['firma']}]}]});
  if(b.op==='rp_empleado_get'){var emp={id:'e1',nombre_completo:'HIDALGO IZA LOURDES PIEDAD',cedula:'1709456055',cargo:'Asistente',sueldo:600,ciudad:'Quito',fecha_ingreso:'2020-01-15',fecha_ingreso_confirmada:true,portal_user:'EFCH',iess:true,decimos_mensual:false,fondo_reserva_modo:'mensual',bono_rutas:80,caja_users:'OPM',bono_etiqueta:'Reembolso',bono_tipo:'reembolso',bono_corte:'26-25',conceptos:[{clave:'hex',etiqueta:'Horas extras',monto:49.98,aporta:true,en13:false}]};if(MODO==='perm')emp.dias_laborables=[1,2,3,4,5];return Promise.resolve({ok:true,empleado:emp});}
  if(b.op==='rp_saldo')return Promise.resolve({ok:true,saldo:{empleado_id:'e1',nombre_completo:'HIDALGO IZA LOURDES PIEDAD',fecha_ingreso:'2020-01-15',al:'2026-11-07',meses_cumplidos:82,devengados:40,usados:10,saldo:12,pendientes:2,regla:'15 días al año'}});
  if(b.op==='rp_sol_list')return Promise.resolve({ok:true,solicitudes:[{id:'s1',empleado_id:'e2',nombre_completo:'OTRO EMPLEADO',fechas:['2026-11-20'],dias:1,motivo:'Médico',estado:'pendiente',creado_nombre:'OTRO',created_at:'2026-11-01'},{id:'s2',empleado_id:'e1',nombre_completo:'HIDALGO IZA LOURDES PIEDAD',fechas:['2026-10-10'],dias:1,motivo:'Viaje',estado:'aprobada',clasificacion:'permiso_corto'}]});
  if(b.op==='rp_sol_aprobar')return Promise.resolve({ok:true});
  if(b.op==='rp_sol_rechazar'||b.op==='rp_sol_anular'){if(!b.motivo)return Promise.resolve({ok:false,error:'El motivo es obligatorio.'});return Promise.resolve({ok:true});}
  if(b.op==='rp_sol_crear'){if(window._solMal)return Promise.resolve({ok:false,error:'Ese día no es laborable.'});return Promise.resolve({ok:true,solicitud:{id:'s9'},saldo:{saldo:11}}); }
  if(b.op==='rp_empleado_save')return Promise.resolve({ok:true,id:b.id||'e9'});
  if(b.op==='rp_novedades_list')return Promise.resolve({ok:true,novedades:[{id:'n1',tipo:'anticipo',monto:200,fecha:'2026-10-05',pagado:0,cuotas_cerradas:0},{id:'n2',tipo:'prestamo_quiro',valor:72.07,pagado:720.7,cuotas_cerradas:10}]});
  if(b.op==='rp_docs_list')return Promise.resolve({ok:true,docs:[{id:'d1',nombre:'Contrato.pdf',tipo:'contrato'}]});
  if(b.op==='rp_doc_url')return Promise.resolve({ok:true,url:'https://example.test/rol.pdf'});
  if(b.op==='rp_generar')return Promise.resolve({ok:true,resultados:[{nombre_completo:'HIDALGO IZA LOURDES PIEDAD',neto:391.38,regenerado:true},{nombre_completo:'OTRO',neto:10,omitido:'cerrado',faltan:['sueldo']}]});
  if(b.op==='rp_cerrar'||b.op==='rp_reabrir'||b.op==='rp_novedad_anular'||b.op==='rp_novedad_save')return Promise.resolve({ok:true});
  return Promise.resolve({ok:false,error:'op '+b.op});
}
function jsPDF(){this.ops=[];window._doc=this;}
jsPDF.prototype.setFont=function(){};jsPDF.prototype.setFontSize=function(){};jsPDF.prototype.setTextColor=function(){};
jsPDF.prototype.setFillColor=function(){};jsPDF.prototype.setDrawColor=function(){};jsPDF.prototype.setLineWidth=function(){};
jsPDF.prototype.text=function(t,x,y,o){this.ops.push({op:'text',t:String(t),x:x,y:y,al:o&&o.align});};
jsPDF.prototype.line=function(){this.ops.push({op:'line'});};
jsPDF.prototype.rect=function(){this.ops.push({op:'rect'});};
jsPDF.prototype.addImage=function(){this.ops.push({op:'img'});};
jsPDF.prototype.getTextWidth=function(t){return String(t).length*1.8;};
jsPDF.prototype.output=function(){return {size:1};};
function mcPlanillaLoadJsPDF(){return Promise.resolve(jsPDF);}
${mod}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
function txt(){return document.getElementById('rp').textContent;}
function fuera(root){var r=root.getBoundingClientRect();var bad='';[].forEach.call(root.querySelectorAll('*'),function(el){if(!el.getClientRects().length)return;var b=el.getBoundingClientRect();if(b.width<2&&b.height<2)return;if(b.right>r.right+2||b.left<r.left-2)bad=bad||((el.className||el.tagName)+' '+(Math.round(b.right-r.right))+'/'+Math.round(r.width));});return bad;}
function bajos(){var bad=[];[].forEach.call(document.querySelectorAll('.rp-btn,.rp-in'),function(el){if(!el.offsetParent)return;if(el.getBoundingClientRect().height<43)bad.push(el.id||el.textContent.slice(0,18));});return bad;}
var MODO='${modo}';
setTimeout(function(){MCRoles.init();setTimeout(function(){
  var box=document.getElementById('maes-screen');
  if(MODO==='off'){if(txt().indexOf('No tienes acceso')<0)return mal('oculto');document.getElementById('result').textContent='OK';document.title='OK';return;}
  if(MODO==='emp'){
    if(txt().indexOf('+ Empleado')>=0||txt().indexOf('Permisos y vacaciones')>=0)return mal('emp ve de mas');
    if(txt().indexOf('Fichas')<0||txt().indexOf('Roles de pago')<0||txt().indexOf('Documentos')<0)return mal('emp tabs');
    if(window._posts.some(function(p){return p.op==='rp_empleados_list';}))return mal('emp lista ajena');
    document.querySelector('[data-rp="tab"][data-k="roles"]').click();
    setTimeout(function(){
      if(txt().indexOf('OCTUBRE 2026')<0||txt().indexOf('Generar')>=0)return mal('emp roles');
      if(document.querySelector('[data-k="presta"]'))return mal('emp presta');
      document.querySelector('[data-rp="tab"][data-k="mispre"]').click();
      setTimeout(function(){
        var box=document.getElementById('rp-pre-list');
        var cv=box&&box.querySelector('.rp-cv');
        if(!cv||cv.getAttribute('data-cv').indexOf('comp.png')<0)return mal('visor');
        var img=cv.querySelector('img');
        if(!img||img.getAttribute('draggable')!=='false'||img.getAttribute('src').indexOf('comp.png')<0)return mal('imagen');
        if(box.querySelector('a')||box.textContent.indexOf('Descargar')>=0)return mal('descarga');
        if(box.innerHTML.indexOf('_blank')>=0)return mal('pestaña');
        document.getElementById('result').textContent='OK';document.title='OK';
      },40);
    },40);
    return;
  }
  if(MODO==='perm'){
    if(!document.querySelector('[data-rp="tab"][data-k="permisos"]'))return mal('sin permisos');
    document.querySelector('[data-rp="tab"][data-k="permisos"]').click();
    setTimeout(function(){
      var p=document.getElementById('rp-perm');
      if(!p||p.textContent.indexOf('Días disponibles')<0||p.textContent.indexOf('12')<0)return mal('saldo');
      if(p.textContent.indexOf('Devengados')<0||p.textContent.indexOf('Usados')<0||p.textContent.indexOf('Pendientes')<0)return mal('detalle saldo');
      var cards=p.querySelectorAll('.rp-card');
      if(!cards.length||cards[0].textContent.indexOf('OTRO EMPLEADO')<0)return mal('pendientes arriba');
      if(p.textContent.indexOf('Descuenta vacaciones')<0||p.textContent.indexOf('Día cambiado')<0||p.textContent.indexOf('Permiso corto')<0)return mal('botones');
      var pasado=[].filter.call(p.querySelectorAll('.rp-cd'),function(el){return el.getAttribute('data-d')==='2026-11-01';})[0];
      var domingo=[].filter.call(p.querySelectorAll('.rp-cd'),function(el){return el.getAttribute('data-d')==='2026-11-08';})[0];
      var lunes=[].filter.call(p.querySelectorAll('.rp-cd'),function(el){return el.getAttribute('data-d')==='2026-11-09';})[0];
      if(!pasado||!pasado.disabled||!domingo||!domingo.disabled)return mal('dias bloqueados');
      if(!lunes||lunes.disabled)return mal('lunes');
      lunes.click();
      if(document.getElementById('rp-sol-mot'))document.getElementById('rp-sol-mot').value='Cita';
      document.querySelector('[data-rp="sol-crear"]').click();
      setTimeout(function(){
        var cr=window._posts.filter(function(q){return q.op==='rp_sol_crear';}).pop();
        if(!cr||cr.fechas.join(',')!=='2026-11-09'||cr.motivo!=='Cita')return mal('crear');
        document.querySelector('[data-rp="sol-ok"][data-c="descuenta_vacaciones"]').click();
        setTimeout(function(){
          var ap=window._posts.filter(function(q){return q.op==='rp_sol_aprobar';}).pop();
          if(!ap||ap.id!=='s1'||ap.clasificacion!=='descuenta_vacaciones')return mal('aprobar');
          document.querySelector('[data-rp="sol-no"]').click();
          document.querySelector('[data-rp="sol-no-ok"]').click();
          var er=document.getElementById('rp-err');
          if(!er||er.textContent!=='El motivo es obligatorio.')return mal('motivo');
          if(window._posts.some(function(q){return q.op==='rp_sol_rechazar';}))return mal('rechazo vacio');
          document.getElementById('result').textContent='OK';document.title='OK';
        },40);
      },40);
    },40);
    return;
  }
  if(MODO==='conta'){
    if(txt().indexOf('+ Empleado')>=0||txt().indexOf('Generar')>=0||txt().indexOf('Permisos y vacaciones')>=0)return mal('conta edita');
    if(txt().indexOf('HIDALGO IZA LOURDES PIEDAD')<0)return mal('conta lista');
    document.querySelector('[data-rp="emp"]').click();
    setTimeout(function(){
      var sh=document.getElementById('rp-sh');
      if(document.getElementById('rp-sheet').hidden)return mal('conta ficha');
      if(document.getElementById('rp-nom')&&!document.getElementById('rp-nom').disabled)return mal('conta campo');
      if(sh.textContent.indexOf('Guardar')>=0||sh.textContent.indexOf('Anular')>=0||sh.textContent.indexOf('Subir')>=0)return mal('conta boton');
      document.querySelector('[data-rp="etab"][data-k="nov"]').click();
      setTimeout(function(){
        var sh2=document.getElementById('rp-sh');
        if(sh2.textContent.indexOf('Anular')>=0||sh2.textContent.indexOf('Guardar novedad')>=0)return mal('conta nov');
        if(sh2.textContent.indexOf('Se descuenta en el rol del mes siguiente')<0)return mal('anticipo');
        if(sh2.textContent.indexOf('Cuotas cerradas 10')<0||sh2.textContent.indexOf('Pagado')<0)return mal('pagado');
        var f=fuera(sh2);if(f)return mal('fuera '+f);
        var bh=bajos();if(bh.length)return mal('bajo '+bh[0]);
        document.getElementById('result').textContent='OK';document.title='OK';
      },40);
    },40);
    return;
  }
  if(!MCRoles.puede())return mal('puede');
  if(txt().indexOf('Fichas')<0||txt().indexOf('Roles de pago')<0||txt().indexOf('Documentos')<0)return mal('tabs');
  if(txt().indexOf('Permisos y vacaciones')>=0)return mal('permisos visible');
  if(txt().indexOf('+ Empleado')<0)return mal('admin');
  var f0=fuera(box);if(f0)return mal('lista '+f0);
  document.querySelector('[data-rp="emp"]').click();
  setTimeout(function(){
    var sh=document.getElementById('rp-sh');
    if(!sh||document.getElementById('rp-sheet').hidden)return mal('sheet');
    var st=getComputedStyle(document.getElementById('rp-sheet'));
    if(st.alignItems!=='flex-end'&&innerWidth>=900){}
    if(innerWidth<900&&st.alignItems!=='flex-end')return mal('sheet top');
    if(innerWidth>=900&&st.alignItems!=='center')return mal('sheet centro');
    var nom=document.getElementById('rp-nom'),ced=document.getElementById('rp-ced');
    if(!nom||nom.value!=='HIDALGO IZA LOURDES PIEDAD')return mal('nombre');
    if(document.getElementById('rp-user').value!=='EFCH')return mal('usuario');
    if(sh.textContent.indexOf('Esteban Ferlito')<0)return mal('select');
    if(sh.textContent.indexOf('Reembolso por rutas')<0)return mal('bloque');
    if(sh.textContent.indexOf('Días laborables')<0)return mal('dias');
    ['L','M','X','J','V','S','D'].forEach(function(x){if(sh.textContent.indexOf(x)<0)mal('letra '+x);});
    if(document.title==='FAIL')return;
    document.querySelector('#rp-dias input[value="1"]').checked=true;
    document.querySelector('#rp-dias input[value="3"]').checked=true;
    document.querySelector('[data-rp="con-add"]').click();
    nom.value='perez ana';ced.value='1709456055';
    document.querySelector('[data-rp="guardar"]').click();
    setTimeout(function(){
      var sv=window._posts.filter(function(p){return p.op==='rp_empleado_save';}).pop();
      if(!sv||sv.nombre_completo!=='PEREZ ANA'||sv.cedula!=='1709456055'||sv.portal_user!=='EFCH')return mal('save');
      if(sv.user!=='EFCH')return mal('actor');
      if(!sv.dias_laborables||sv.dias_laborables.join(',')!=='1,3')return mal('dias save '+(sv.dias_laborables&&sv.dias_laborables.join(',')));
      document.querySelector('[data-rp="tab"][data-k="roles"]').click();
      setTimeout(function(){
      if(txt().indexOf('Vista previa')<0||txt().indexOf('Borrador — no visible para el empleado')<0)return mal('chip');
      document.querySelector('[data-rp="hist"]').click();
      setTimeout(function(){
      if(txt().indexOf('Historial')<0||txt().indexOf('OCTUBRE 2026')<0||!document.querySelector('[data-rp="pdfid"]'))return mal('historial');
      document.querySelector('[data-rp="back"]').click();
      document.querySelector('[data-rp="genall"]').click();
      setTimeout(function(){
        var g=txt();
        if(g.indexOf('regenerado')<0||g.indexOf('omitido: cerrado')<0||g.indexOf('faltan: sueldo')<0||g.indexOf('$391.38')<0)return mal('resultados');
        var gen=window._posts.filter(function(p){return p.op==='rp_generar';}).pop();
        if(!gen||gen.empleado_id||gen.periodo.slice(0,7).length!==7)return mal('gen todos');
        document.querySelector('[data-rp="prev"]').click();
        setTimeout(function(){
          var d=txt();
          if(d.indexOf('$820.15')<0||d.indexOf('$391.38')<0||d.indexOf('$428.77')<0)return mal('totales servidor');
          if(d.indexOf('740.15')>=0||d.indexOf('511.88')>=0)return mal('sumo');
          if(d.indexOf('Alimentación')>=0)return mal('cero');
          if(d.indexOf('340')>=0||d.indexOf('detalle interno')>=0)return mal('rutas en vista');
          if(d.indexOf('Descargar PDF')<0||d.indexOf('Corregir')<0||d.indexOf('Publicar')<0||d.indexOf('Adjuntar pago')<0)return mal('acciones');
          if(d.indexOf('Borrador — no visible para el empleado')<0)return mal('no publicado');
          var pv=window._posts.filter(function(p){return p.op==='rp_preview'||p.op==='rp_rol_get';}).pop();
          if(!pv||pv.op!=='rp_preview')return mal('fuente');
          document.querySelector('[data-rp="publicar"]').click();
          if((document.getElementById('rp-sh')||{}).textContent.indexOf('Una vez publicado, HIDALGO IZA LOURDES PIEDAD lo verá y deberá firmarlo.')<0)return mal('confirma');
          document.querySelector('[data-rp="sheet-x"]').click();
          if(d.indexOf('10/10')<0||d.indexOf('Reembolso')<0)return mal('etiqueta');
          var ing=document.getElementById('rp-ing'),ded=document.getElementById('rp-ded');
          var ib=ing.getBoundingClientRect(),db=ded.getBoundingClientRect();
          if(innerWidth<900){if(!(ib.bottom<=db.top+2))return mal('columnas movil');}
          else if(!(ib.left+20<db.left))return mal('columnas desk');
          document.querySelector('[data-rp="pdf"]').click();
          setTimeout(function(){
            var ops=(window._doc&&window._doc.ops)||[];
            var texts=ops.filter(function(o){return o.op==='text';}).map(function(o){return o.t;});
            var all=texts.join('\\n');
            var falta=null;['ESTEBAN FERLITO','RUC 1793194965001','ROL DE PAGOS MENSUAL','HIDALGO IZA LOURDES PIEDAD','1709456055','OCTUBRE 2026','01-oct-26','31-oct-26','Sueldo','$600.00','$820.15','$428.77','$391.38','$120.50','10/10','REEMBOLSOS (no remunerativos)','Reembolso','Total a recibir','Recibí conforme:','Generado en portal Minecore'].forEach(function(s){if(all.indexOf(s)<0)falta=s;});
            if(falta)return mal('pdf '+falta);
            if(all.indexOf('Alimentación')>=0||all.indexOf('340')>=0||all.indexOf('detalle interno')>=0||/transporte|camioneta|\\brutas\\b|\\bbono\\b/i.test(all))return mal('pdf sobra');
            if(ops.some(function(o){return o.op==='img';}))return mal('logo');
            var ix=ops.filter(function(o){return o.t==='INGRESOS';})[0],dx=ops.filter(function(o){return o.t==='DEDUCCIONES';})[0];
            if(!ix||!dx||!(ix.x<dx.x))return mal('pdf cols');
            if(!window._dl.length||window._dl[0]!=='ROL OCTUBRE 2026 HIDALGO IZA LOURDES PIEDAD.pdf')return mal('archivo '+window._dl[0]);
            document.querySelector('[data-rp="back"]').click();
            setTimeout(function(){
            var mis=document.querySelector('[data-rp="mios"]');if(!mis)return mal('sin mis roles');mis.click();
            setTimeout(function(){
              if(txt().indexOf('OCTUBRE 2026')<0||txt().indexOf('$391.38')<0||txt().indexOf('Pagado ✓')<0)return mal('mios');
              if(txt().indexOf('Recibí conforme')>=0)return mal('boton viejo');
              if(txt().indexOf('Pendiente de firma')<0)return mal('pendiente');
              document.querySelector('[data-rp="rol"]').click();
              setTimeout(function(){
                var shf=document.getElementById('rp-sh');
                if(!shf||document.getElementById('rp-sheet').hidden||!document.getElementById('rp-firma'))return mal('modal');
                if(shf.textContent.indexOf('Ver el rol')>=0)return mal('modal se cierra');
                document.querySelector('[data-rp="nofirmar"]').click();
                setTimeout(function(){
                  var nf=window._posts.filter(function(p){return p.op==='rp_no_firmar';}).pop();
                  if(!nf||nf.id!=='r1'||nf.motivo)return mal('no firmar');
                  if(txt().indexOf('No firmado')<0)return mal('chip rojo');
                  var otra=document.querySelector('[data-rp="firmar-de-nuevo"]');if(!otra)return mal('sin firmar de nuevo');otra.click();
                  setTimeout(function(){
                    if(document.getElementById('rp-sh').textContent.indexOf('Ver el rol')<0)return mal('otra vez');
                    var c=document.getElementById('rp-firma'),rc=c.getBoundingClientRect();
                    function pe(t,x,y){c.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:rc.left+x,clientY:rc.top+y,pointerId:1}));}
                    pe('pointerdown',8,8);pe('pointermove',30,20);pe('pointermove',60,40);pe('pointermove',90,30);pe('pointerup',90,30);
                    document.querySelector('[data-rp="firmar-ok"]').click();
                    setTimeout(function(){
                      var sf=window._posts.filter(function(p){return p.op==='rp_firmar';}).pop();
                      if(!sf||!sf.firma_png_base64)return mal('firmar');
                      if(window._posts.some(function(p){return p.op==='rp_recibir';}))return mal('recibir');
                      if(txt().indexOf('Recibido')<0)return mal('recibido');
                      document.querySelector('[data-rp="pdf"]').click();
                      setTimeout(function(){
                    var e=txt();
                    if(e.indexOf('340')>=0||e.indexOf('detalle interno')>=0||/transporte|camioneta|\\brutas\\b|\\bbono\\b/i.test(e))return mal('empleado ve detalle');
                    if(e.indexOf('Reembolso')<0||e.indexOf('$391.38')<0||e.indexOf('Descargar PDF')<0)return mal('empleado detalle');
                    var ing2=document.getElementById('rp-ing'),ded2=document.getElementById('rp-ded');
                    if(innerWidth<900&&!(ing2.getBoundingClientRect().bottom<=ded2.getBoundingClientRect().top+2))return mal('emp columnas');
                    var bh=bajos();if(bh.length)return mal('bajo '+bh[0]);
                    var f=fuera(box);if(f)return mal('fuera '+f);
                    if(box.scrollWidth>box.clientWidth+2)return mal('scroll '+box.scrollWidth+'/'+box.clientWidth);
                    var nb=document.querySelector('.rp-kv b');if(nb&&nb.scrollWidth>nb.clientWidth+2)return mal('recorte '+nb.scrollWidth+'/'+nb.clientWidth+' '+nb.textContent);
                    if(e.indexOf('Confirmado digitalmente')<0||e.indexOf('Esteban Ferlito')<0)return mal('firma digital');
                    var ops2=(window._doc&&window._doc.ops)||[];
                    if(!ops2.some(function(o){return o.op==='img';}))return mal('firma pdf');
                    if(!ops2.some(function(o){return o.t==='Recibí conforme:';}))return mal('leyenda');
                    document.getElementById('result').textContent='OK';document.title='OK';
                  },40);
                },40);
              },40);
            },40);
          },40);
        },40);
      },40);
    },40);
  },40);
  },40);
  },40);
  },40);
  },40);
  },40);
},60);},30);
</script>`;
}

const dir = '/tmp/roles-pago';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
const jobs = [320, 375, 390, 430, 1280].map((w) => ['adm', w]).concat([['conta', 390], ['conta', 1280], ['off', 390], ['emp', 390], ['perm', 320], ['perm', 390]]);
const only = process.env.ONLY || '';
for (const [modo, w] of jobs) {
  if (only && only !== modo + ' ' + w) continue;
  const file = join(dir, modo + '-' + w + '.html');
  writeFileSync(file, page(w, modo));
  const shot = modo === 'adm' && w === 390 ? ['--screenshot=/opt/cursor/artifacts/roles-pago-390.png'] : [];
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-rp-' + modo + '-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=8000', ...shot, '--dump-dom', file], { encoding: 'utf8', timeout: 30000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(modo + ' ' + w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(modo, w, 'OK');
}
