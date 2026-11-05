/**
 * Etiqueta Clientes 51×19 con Code128 compacto. Datos de prueba.
 * El decoder es zbar (imagen), no una pistola física.
 *   node tests/etiq-clientes-layout.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'etiq/clientes-layout.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const lay = sandbox.MCCliLay;

const sku = 'PRUEBA000261';
const fit = lay.fit(sku);
if (fit.module < lay.MIN_MOD) throw new Error('modulo ' + fit.module);
if (fit.sym.quiet !== 10) throw new Error('quiet');
const longName = 'HO LOCKING COUPLING FULL HOLE W/O HEAT TREATED - BOYLES BROS DE PRUEBA';
const words = longName.split(/\s+/);

function pbm(sku) {
  const sym = lay.symbol(sku);
  const px = 4;
  const quiet = 10 * px;
  let mods = 0;
  sym.pats.forEach((p) => { for (const ch of p) mods += +ch; });
  const w = mods * px + quiet * 2;
  const h = 80;
  const row = new Uint8Array(w);
  row.fill(255);
  let x = quiet;
  for (const p of sym.pats) {
    let black = true;
    for (const ch of p) {
      const ww = (+ch) * px;
      if (black) row.fill(0, x, x + ww);
      x += ww;
      black = !black;
    }
  }
  const bytesPer = Math.ceil(w / 8);
  const body = Buffer.alloc(bytesPer * h);
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      if (row[i] === 0) body[y * bytesPer + (i >> 3)] |= 0x80 >> (i & 7);
    }
  }
  const head = Buffer.from(`P4\n${w} ${h}\n`);
  return Buffer.concat([head, body]);
}
mkdirSync('/tmp/etiq-bars', { recursive: true });
const pbmPath = '/tmp/etiq-bars/prueba.pbm';
writeFileSync(pbmPath, pbm(sku));
const dec = spawnSync('zbarimg', ['-q', '--raw', pbmPath], { encoding: 'utf8' });
if (dec.status !== 0 || dec.stdout.trim() !== sku) {
  throw new Error('zbar ' + dec.status + ' ' + dec.stdout + ' ' + dec.stderr);
}

const req = createRequire('/tmp/jspdfpkg/package.json');
const { jsPDF } = req('jspdf');
const doc = new jsPDF({ unit: 'mm', format: [51, 19], orientation: 'landscape' });
const info = lay.draw(doc, { nombre: longName, sku, qty: 3, ov: 'PRUEBA-SO-0001' });
if (doc.internal.pageSize.getWidth() !== 51 || doc.internal.pageSize.getHeight() !== 19) {
  throw new Error('pagina ' + doc.internal.pageSize.getWidth() + 'x' + doc.internal.pageSize.getHeight());
}
const pdf = doc.output();
for (const w of words) if (!pdf.includes(w)) throw new Error('falta ' + w);
if (!pdf.includes(sku) || !pdf.includes('PRUEBA-SO-0001')) throw new Error('falta codigo u OV');
if (info.moduleMm < 0.19) throw new Error('modulo pdf');
writeFileSync('/opt/cursor/artifacts/etiq-clientes-prueba.pdf', Buffer.from(doc.output('arraybuffer')));

const html = readFileSync(join(root, 'index.html'), 'utf8');
const i = html.indexOf("if(t==='despacho')");
const desp = html.slice(i, i + 80);
if (!desp.includes('MCCliLay.xml')) throw new Error('xml despacho');
const bodega = html.slice(html.indexOf('else o=txt', i), html.indexOf('else o=txt', i) + 220);
if (!bodega.includes('bc(')) throw new Error('bodega sin barras');
const labels = html.slice(html.indexOf("kind==='labels'"), html.indexOf("kind==='labels'") + 400);
if (labels.includes('mcCode128')) throw new Error('labels sigue con el barcode viejo a todo el ancho');
if (!html.includes("MC_BUILD='560'")) throw new Error('build');
console.log('etiq-clientes-layout OK', 'modulo_mm', info.moduleMm.toFixed(3), 'zbar', sku);
