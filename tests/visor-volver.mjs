/** b680 t1913: visor a pantalla completa → «← Volver» debajo de la barra roja y atrás del navegador lo cierra.
 *  node tests/visor-volver.mjs   (usa google-chrome headless; sin red externa) */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
const h = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vis = h.slice(h.indexOf('/* b680 t1913 EFCH: en el portal del cliente'), h.indexOf('/* b680 t1913: visor en la app para un URL'));
const page = `<!doctype html><html><body><div id="mc-imp-bar" style="position:fixed;top:0;left:0;right:0;height:44px;z-index:2147483000">Vista previa</div><pre id="r"></pre><script>${vis}<\/script><script>
var R=[];function log(x){R.push(x);document.getElementById('r').textContent=R.join('\\n');}
history.replaceState({mcPortal:1},'','#/cdash');var H0=history.length;
function mk(){var v=document.createElement('div');v.id='mdoc-v';v.style.cssText='position:fixed;inset:0;z-index:400';v.innerHTML='<button>← Volver</button>';v.firstChild.onclick=function(){v.remove();};document.body.appendChild(v);return v;}
setTimeout(function(){var v=mk();setTimeout(function(){log('T1 '+(getComputedStyle(v).top==='44px'));
  v.remove();mk(); /* se vuelve a pintar */
  setTimeout(function(){log('T2 '+(mcVisorPila()===1&&history.state&&history.state.mcov===1));history.back();
    setTimeout(function(){log('T3 '+(!document.getElementById('mdoc-v')&&location.hash==='#/cdash'&&mcVisorPila()===0));
      var v2=mk();setTimeout(function(){v2.firstChild.click();setTimeout(function(){log('T4 '+(!document.getElementById('mdoc-v')&&!(history.state&&history.state.mcov)));log('FIN');},300);},100);},300);},100);},100);},100);
<\/script></body></html>`;
const d = mkdtempSync(join(tmpdir(), 'vv-')); writeFileSync(join(d, 't.html'), page);
const srv = spawnSync('bash', ['-c', `cd ${d} && (python3 -m http.server 8766 >/dev/null 2>&1 & echo $! > pid) && sleep 1 && google-chrome --headless=new --no-sandbox --disable-gpu --virtual-time-budget=5000 --dump-dom http://127.0.0.1:8766/t.html 2>/dev/null; kill $(cat pid)`], { encoding: 'utf8' });
const r = (srv.stdout.match(/<pre id="r">([\s\S]*?)<\/pre>/) || [])[1] || '';
const want = { T1: '«Volver» debajo de la barra roja', T2: 'repintar no duplica el historial', T3: 'atrás cierra el visor y no cambia de pantalla', T4: '«← Volver» limpia el historial' };
for (const k of Object.keys(want)) { const pass = r.includes(k + ' true'); console.log((pass ? 'OK  ' : 'FALLA ') + want[k]); if (!pass) process.exitCode = 1; }
