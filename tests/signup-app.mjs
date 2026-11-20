/**
 * b707 t2073u: «Crear cuenta» en la app (pasos 1-4 + aviso de pendiente), 390 y escritorio, con servidor simulado.
 *   node tests/signup-app.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='707'")) throw new Error('build');
if (!sw.includes("var SWV='b707'")) throw new Error('sw');
const i0 = html.indexOf('<style id="mc-signup-css">'), i1 = html.indexOf('<script>/* b707 t2073u EFCH: Aprobaciones');
if (i0 < 0 || i1 < 0) throw new Error('bloques');
const blk = html.slice(i0, i1);
const out = process.env.OUT || '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });
const steps = ['p1', 'p2', 'p3', 'org', 'fin', 'pend', 'login'];
let fails = 0;
for (const w of [390, 1280]) for (const st of steps) {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>signup</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}#login{background:#fff;min-height:100vh;padding-top:12vh}#login .box{max-width:380px;margin:0 auto;padding:0 20px}
#login input{display:block;width:100%;box-sizing:border-box;padding:12px;margin-bottom:10px;border:1px solid #ccd6e0;border-radius:10px;font-size:16px}
#login button{width:100%;margin-top:12px;background:#1e4976;border:none;color:#fff;border-radius:10px;padding:13px;font-size:15px;font-weight:700}
.chip{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6;min-height:40px;padding:0 12px}#home{padding:16px}</style>
<div id="login"><div class="box"><input id="usr" placeholder="Usuario"><input id="pin" placeholder="PIN"><button onclick="doLogin()">Ingresar</button></div></div>
<div id="shell" style="display:${st === 'pend' ? 'block' : 'none'}"><div id="home"><div class="cbz-card">📦 Inventario</div></div></div>
<div id="result"></div>
<script>
var MC_SB_URL='https://x/portal-api',calls=[];
var R={signup_cfg:{ok:true,on:true},signup_start:{ok:true,id:7,email:'ana@empresa.com'},signup_verify:{ok:true,paso:'p',tipo:'cliente'},signup_org:{ok:true,necesitaOrg:true}};
window.fetch=function(u,o){var b=JSON.parse(o.body);calls.push(b.action);return Promise.resolve({json:function(){return Promise.resolve(R[b.action]||{ok:false});}});};
function getProfile(){return ${st === 'pend' ? "{rol:'cliente',aprobado:false,nombre:'ana'}" : 'null'};}
function getUserName(){return 'ana';}
function MCusr(p){return Promise.resolve({ok:true,autoregistro:true,pendiente:true,rol:'cliente',empresa:'Huakan International Ecuador Cia Ltda',aprobador:'el administrador de tu organización'});}
function renderHome(){}
</script>
${blk}
<script>
var ST='${st}';
setTimeout(function(){
  if(ST==='login'){return;}
  if(ST==='pend'){MCSignup.aviso();return;}
  MCSignup.abrir();
  if(ST==='p1')return;
  MCSignup.tipo('cliente');
  var f={'su-full':'Ana María Pérez Lozada','su-ced':'1712345678','su-tel':'0991234567','su-mail':'ana@empresa.com','su-usr':'anap','su-pin':'4826','su-pin2':'4826'};
  for(var k in f)document.getElementById(k).value=f[k];document.getElementById('su-acep').checked=true;
  MCSignup.enviar();
  setTimeout(function(){ if(ST==='p2')return; document.getElementById('su-code').value='123456';MCSignup.verificar();
    setTimeout(function(){ if(ST==='p3')return; document.getElementById('su-ruc').value='1799999999001';MCSignup.org();
      setTimeout(function(){ if(ST==='org')return; R.signup_org={ok:true,estado:'activo',empresa:'Andes Perforaciones S.A.',usuario:'anap',mensaje:'Listo: creamos «Andes Perforaciones S.A.» y tú eres su administrador (máster). Ya puedes entrar con tu usuario y PIN.'};
        var o={'su-rs':'Andes Perforaciones S.A.','su-dir':'Av. Amazonas N34 y Atahualpa','su-ciu':'Quito'};for(var k in o)document.getElementById(k).value=o[k];MCSignup.org();},200);},200);},200);
},300);
setTimeout(function(){document.getElementById('result').textContent='CALLS:'+calls.join(',')+'|BTN:'+(document.getElementById('mc-su-btn')||{style:{}}).style.display+'|PEND:'+!!document.getElementById('mc-supend')+'|ERR:'+((document.getElementById('su-err')||{}).textContent||'');},2500);
</script>`;
  const file = '/tmp/signup-' + w + '-' + st + '.html';
  writeFileSync(file, page);
  const run = spawnSync((process.env.CHROME||'/usr/local/bin/google-chrome'), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--user-data-dir=/tmp/chrome-su-' + w + st, '--window-size=' + w + ',' + (w === 390 ? 1300 : 1000), '--virtual-time-budget=4000', '--screenshot=' + out + '/signup-' + w + '-' + st + '.png', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 30000 });
  const m = /CALLS:([^<]*)/.exec(run.stdout || '');
  const r = m ? m[0] : 'SIN RESULTADO';
  const want = { p1: /BTN:block/, p2: /signup_start/, p3: /signup_verify/, org: /signup_org\|/, fin: /signup_org,signup_org/, pend: /PEND:true/, login: /BTN:block/ }[st];
  const ok = want.test(r) && !/ERR:[^|<]+$/.test(r.replace(/ERR:$/, ''));
  if (!ok) fails++;
  console.log(ok ? 'OK ' : 'FAIL', w, st, r);
}
if (fails) process.exit(1);
