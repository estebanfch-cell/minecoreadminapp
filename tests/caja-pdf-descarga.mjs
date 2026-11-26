/**
 * Caja chica y Rutas: descarga de PDF y rango Desde/Hasta de cualquier fecha.
 *   node --test tests/caja-pdf-descarga.mjs
 * El PDF de prueba usa datos sintéticos (sin clientes ni datos reales).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = dirname(root); // /workspace/caja-rutas-pdf
const html = readFileSync(join(root, 'index.html'), 'utf8');
const caja = readFileSync(join(root, 'caja.js'), 'utf8');
const css = readFileSync(join(root, 'caja.css'), 'utf8');

function loadJsPdf() {
  const candidates = [
    join(work, 'node_modules/jspdf/dist/jspdf.node.min.js'),
    join(work, 'node_modules/jspdf/dist/jspdf.node.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const req = createRequire(pathToFileURL(p).href);
      return req(p);
    }
  }
  try {
    const req = createRequire(join(work, 'package.json'));
    return req('jspdf');
  } catch (e) {
    throw new Error('jsPDF no está en ' + work + '/node_modules (npm install jspdf@2.5.1). ' + e.message);
  }
}

test('build 727 y cache-bust de caja.js/css', () => {
  assert.match(html, /var MC_BUILD='727'/);
  assert.match(html, /caja\.js\?v=424/);
  assert.match(html, /caja\.css\?v=330/);
  assert.match(html, /function mcDownloadBlob/);
  assert.match(html, /function mcArmPdfTab/);
});

test('caja.js entrega el PDF con mcDownloadBlob y no con doc.save como camino principal', () => {
  assert.match(caja, /function _pdfEntregar/);
  assert.match(caja, /function _pdfArmarTab/);
  assert.match(caja, /mcArmPdfTab/);
  assert.match(caja, /mcDownloadBlob\(blob, filename, 'application\/pdf', tab\)/);
  assert.match(caja, /try\{ doc\.save\(filename\);/);
  const saveAt = caja.indexOf('try{ doc.save(filename);');
  const entregarAt = caja.indexOf('function _pdfEntregar');
  const corteAt = caja.indexOf('async function descargarCortePDF');
  const cajaAt = caja.indexOf('async function descargarCajaPDF');
  assert.ok(saveAt > entregarAt && saveAt < corteAt, 'doc.save queda dentro de _pdfEntregar, antes de descargar*');
  assert.ok(!caja.slice(corteAt).includes('doc.save('));
  assert.ok(!caja.slice(cajaAt).includes('doc.save('));
});

test('Desde/Hasta de cualquier fecha en Historial de rutas, Historial Caja y Corte', () => {
  assert.match(caja, /function filtroPeriodoHtml/);
  assert.match(caja, /date-lbl">Desde/);
  assert.match(caja, /date-lbl">Hasta/);
  assert.match(caja, /filtroPeriodoHtml\('h'/);
  assert.match(caja, /filtroPeriodoHtml\('cor'/);
  assert.match(caja, /filtroPeriodoHtml\('caj'/);
  assert.match(caja, /↓ Generar PDF de este rango/);
  assert.match(css, /\.date-lbl/);
  assert.match(css, /\.rango-card/);
  assert.match(css, /flex-wrap:wrap/);
  // applyDateFiltro ya no usa toISOString (corría el día después de las 19:00 en Ecuador)
  const fn = caja.slice(caja.indexOf('function applyDateFiltro'), caja.indexOf('function filterByDate'));
  assert.doesNotMatch(fn, /toISOString/);
  assert.match(fn, /today\(\)/);
  assert.match(fn, /ymdLocal/);
  assert.match(caja, /maxBack=maxBack\|\|240/);
  assert.match(caja, /function _pdfEsTodo/);
  assert.match(caja, /2020-01-01/);
});

function loadCaja(jsPDF) {
  const downloads = [];
  const document = {
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {}, onclick: null, href: '', download: '', src: '', onload: null, onerror: null };
    },
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  const windowObj = {
    jspdf: { jsPDF },
    toast() {},
    document,
    mcDownloadBlob(blob, filename, mime, tab) {
      downloads.push({ blob, filename, mime, tab });
      return Promise.resolve();
    },
    mcArmPdfTab() { return { armed: true, closed: false, document: { open() {}, write() {}, close() {}, getElementById() { return null; } } }; },
    mcClosePdfTab_() {},
  };
  windowObj.window = windowObj;
  const ctx = {
    window: windowObj,
    document,
    toast: windowObj.toast,
    mcDownloadBlob: windowObj.mcDownloadBlob,
    mcArmPdfTab: windowObj.mcArmPdfTab,
    mcClosePdfTab_: windowObj.mcClosePdfTab_,
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    Promise, Date, Math, String, Number, Boolean, Array, Object, Error,
    parseFloat, parseInt, isNaN, isFinite, undefined,
    setTimeout, clearTimeout, console,
    encodeURIComponent, decodeURIComponent,
  };
  createContext(ctx);
  runInContext(caja, ctx, { filename: 'caja.js' });
  return { ctx, window: windowObj, downloads };
}

test('PDF de rutas y caja para un rango arbitrario 2026-09-26..2026-10-25', async () => {
  const jspdfMod = loadJsPdf();
  const jsPDF = jspdfMod.jsPDF || jspdfMod;
  const { window: w, downloads } = loadCaja(jsPDF);
  w._hFiltro = 'custom';
  w._corFiltro = 'todo'; // no debe heredar «todo» cuando hay fechas concretas
  w._histRutas = [
    { 'Fecha Servicio': '2026-09-26', Destino: 'Sitio de prueba Norte', KM: 10, 'Valor ($)': 4, Usuario: 'Chofer A', Vehiculo: 'Camioneta Nissan', Estado: 'Aprobada', Notas: '' },
    { 'Fecha Servicio': '2026-10-05', Destino: 'Sitio de prueba Centro', KM: 12.5, 'Valor ($)': 5, Usuario: 'Chofer A', Vehiculo: 'Camioneta Nissan', Estado: 'Aprobada', Notas: '' },
    { 'Fecha Servicio': '2026-10-25', Destino: 'Sitio de prueba Sur', KM: 8, 'Valor ($)': 3.2, Usuario: 'Chofer A', Vehiculo: 'Camioneta Nissan', Estado: 'Aprobada', Notas: '' },
    { 'Fecha Servicio': '2026-08-15', Destino: 'Fuera de rango agosto', KM: 99, 'Valor ($)': 40, Usuario: 'Chofer A', Vehiculo: 'Camioneta Nissan', Estado: 'Aprobada', Notas: '' },
  ];
  w._cajFiltro = 'custom';
  w._cajEnt = [
    { Fecha: '2026-10-01', 'Monto ($)': 100, Admin: 'Admin A', 'Usuario Destino': 'Chofer A', Forma: 'Efectivo' },
    { Fecha: '2026-08-01', 'Monto ($)': 999, Admin: 'Admin A', 'Usuario Destino': 'Chofer A', Forma: 'Efectivo' },
  ];
  w._cajGas = [
    { Fecha: '2026-10-10', 'Monto ($)': 20, Usuario: 'Chofer A', Descripcion: 'Combustible de prueba', Estado: 'Aprobado' },
    { Fecha: '2026-11-01', 'Monto ($)': 50, Usuario: 'Chofer A', Descripcion: 'Fuera de rango noviembre', Estado: 'Aprobado' },
  ];

  assert.equal(w._pdfEsTodo('todo', '2026-09-26', '2026-10-25'), false);
  assert.equal(w._pdfEsTodo('todo', '2020-01-01', '2099-12-31'), true);
  assert.equal(w._pdfNombre('rutas', 'rango', '2026-09-26', '2026-10-25'), 'Corte de rutas 2026-09-26 a 2026-10-25.pdf');
  assert.equal(w._pdfNombre('caja', 'todo', '2020-01-01', '2099-12-31'), 'Caja chica todas las fechas.pdf');

  await w.descargarCortePDF('2026-09-26', '2026-10-25');
  await w.descargarCajaPDF('2026-09-26', '2026-10-25');
  assert.equal(downloads.length, 2);
  assert.equal(downloads[0].filename, 'Corte de rutas 2026-09-26 a 2026-10-25.pdf');
  assert.equal(downloads[1].filename, 'Caja chica 2026-09-26 a 2026-10-25.pdf');
  assert.ok(downloads[0].tab && downloads[0].tab.armed, 'se arma la pestaña en el mismo toque (iOS)');

  const outDir = join(work, 'out');
  mkdirSync(outDir, { recursive: true });
  const rutasPath = join(outDir, 'corte-rutas-2026-09-26-a-2026-10-25.pdf');
  const cajaPath = join(outDir, 'caja-chica-2026-09-26-a-2026-10-25.pdf');
  writeFileSync(rutasPath, Buffer.from(await downloads[0].blob.arrayBuffer()));
  writeFileSync(cajaPath, Buffer.from(await downloads[1].blob.arrayBuffer()));
  assert.equal(readFileSync(rutasPath).subarray(0, 5).toString(), '%PDF-');
  assert.equal(readFileSync(cajaPath).subarray(0, 5).toString(), '%PDF-');

  const txtR = spawnSync('pdftotext', ['-layout', rutasPath, '-'], { encoding: 'utf8' });
  const txtC = spawnSync('pdftotext', ['-layout', cajaPath, '-'], { encoding: 'utf8' });
  assert.equal(txtR.status, 0, txtR.stderr);
  assert.equal(txtC.status, 0, txtC.stderr);
  const r = txtR.stdout;
  const c = txtC.stdout;
  assert.match(r, /Corte de rutas/);
  assert.match(r, /26 sep 2026/);
  assert.match(r, /25 oct 2026/);
  assert.match(r, /Sitio de prueba Norte/);
  assert.match(r, /Sitio de prueba Centro/);
  assert.match(r, /Sitio de prueba Sur/);
  assert.doesNotMatch(r, /Fuera de rango agosto/);
  assert.match(c, /Caja chica/);
  assert.match(c, /26 sep 2026/);
  assert.match(c, /25 oct 2026/);
  assert.match(c, /Combustible de prueba/);
  assert.match(c, /100/);
  assert.doesNotMatch(c, /Fuera de rango noviembre/);
  // $999 de agosto no es una entrega del rango: queda solo como arrastre/saldo inicial
  assert.match(c, /Saldo inicial \(arrastre del período anterior\): \$999\.00/);
  assert.match(c, /Entregas \(1\)/);
  assert.doesNotMatch(c, /1 ago 2026/);
});
