/**
 * Foto del conteo al enviar: lo posterior no es diferencia. Recontar solo durante el conteo. 390 y escritorio.
 *   node tests/conteo-foto.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
assert.equal(html.includes("var MC_BUILD='625'"), true);
assert.equal(sw.includes("var SWV='b625'"), true);
assert.match(html, /co\.e\.foto/);
assert.match(html, /MCFoto\.cerrar/);
assert.match(html, /No se reabre/);
assert.doesNotMatch(html.slice(html.indexOf("if(s.estado==='aprobada')"), html.indexOf("if(s.estado==='aprobada')") + 800), /onclick="MCCC\.devolver\(\)"/);
const bloque = html.slice(html.indexOf('window.mcConteoFoto='), html.indexOf('/* MCCC-BEGIN'))
  .replace('window.mcConteoFoto=function', 'function mcConteoFoto')
  .replace('window.mcConteoRecHtml=function', 'function mcConteoRecHtml');
const fn = new Function(bloque + '\nreturn {mcConteoFoto:mcConteoFoto, mcConteoRecHtml:mcConteoRecHtml};');
const { mcConteoFoto, mcConteoRecHtml } = fn();
const mov = { at: '2026-11-09T20:00:00.000Z', delta: -2, kind: 'so_pick', actor: 'EFCH', sku: 'MCOR000522', sub: '10-B-2' };

test('sin enviar, el esperado es el stock vivo', () => {
  const x = mcConteoFoto({ sistema: 33, mov: -3, esperado: null }, { estado: 'en_conteo' }, true);
  assert.equal(x.esp, 30);
  assert.equal(x.foto, false);
  assert.equal(x.recontar, false);
});

test('ya enviada, la diferencia usa la foto y no el movimiento posterior', () => {
  const x = mcConteoFoto({ sistema: 33, mov: -8, esperado: 30, recontar_movs: [mov] }, { estado: 'en_revision' }, true);
  assert.equal(x.esp, 30);
  assert.equal(x.foto, true);
  assert.equal(x.recontar, true);
  const h = mcConteoRecHtml(x.movs);
  assert.match(h, /Recontar: hubo movimientos durante el conteo/);
  assert.match(h, /MCOR000522/);
  assert.match(h, /10-B-2/);
  assert.match(h, /Venta -2/);
});

test('sin el interruptor no pide recontar', () => {
  const x = mcConteoFoto({ sistema: 33, mov: -8, esperado: 30, recontar_movs: [mov] }, { estado: 'en_revision' }, false);
  assert.equal(x.recontar, false);
  assert.equal(x.esp, 30);
});

function page(w) {
  const h = mcConteoRecHtml([mov]);
  return `<!doctype html><meta charset="utf-8"><title>cc</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}#box{width:${w}px;box-sizing:border-box;padding:8px}</style>
<div id="box">${h}<div class="ok">Aprobada. No se reabre.</div></div><div id="result"></div>
<script>
var box=document.getElementById('box');
var ok=box.textContent.indexOf('Recontar: hubo movimientos durante el conteo')>=0
  &&box.textContent.indexOf('No se reabre')>=0
  &&box.textContent.indexOf('Devolver')<0
  &&box.scrollWidth<=box.clientWidth+2;
document.getElementById('result').textContent=ok?'OK':('FAIL '+box.scrollWidth+'/'+box.clientWidth);
document.title=document.getElementById('result').textContent;
</script>`;
}
const dir = '/tmp/conteo-foto';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=/tmp/chrome-ccf-${w}`, `--window-size=${w},900`, '--virtual-time-budget=2000', '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== 'OK') throw new Error(w + ' ' + (m ? m[1] : dom.slice(-600)));
  console.log(w, 'OK');
}
