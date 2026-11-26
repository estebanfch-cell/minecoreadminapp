/**
 * b729: entrega de PDF en la app iOS (WKWebView / Capacitor) vs escritorio.
 *   node --test tests/ios-pdf-entrega.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const caja = readFileSync(join(root, 'caja.js'), 'utf8');

function extractFn(src, name, untilNames) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('no está ' + name);
  let end = src.length;
  for (const n of untilNames) {
    const i = src.indexOf('\nfunction ' + n + '(', start + 1);
    if (i > start && i < end) end = i;
  }
  const bar = src.indexOf('\nvar MC_C128', start + 1);
  if (bar > start && bar < end) end = bar;
  return src.slice(start, end);
}

test('fuente: detección iOS app, no pestaña fantasma, no toast falso, plugins y pdf_tmp', () => {
  assert.match(html, /var MC_BUILD='729'/);
  assert.match(html, /function mcIsIosNativeApp/);
  assert.match(html, /function mcCapacitorPdfPlugins_/);
  assert.match(html, /function mcShowIosPdfPanel_/);
  assert.match(html, /function mcUploadPdfTmp_/);
  assert.match(html, /function mcSharePdfViaCapacitor_/);
  assert.match(html, /mc-pdf-ios/);
  assert.match(html, /mc-pdf-ios-open/);
  assert.match(html, /Abrir PDF/);
  assert.match(html, /← Volver/);
  assert.match(html, /action:'pdf_tmp'/);
  assert.match(html, /mcIsIosNativeApp\(\)\)return null/);
  assert.match(html, /P\.Directory&&P\.Directory\.Cache/);
  assert.doesNotMatch(caja, /toast\('✓ PDF listo'\)/);
  // En la app iOS no se declara éxito por un window.open truthy
  const dl = extractFn(html, 'mcDownloadBlob', ['mcPickFirst']);
  assert.match(dl, /mcIsIosNativeApp/);
  assert.match(dl, /mcShowIosPdfPanel_/);
  assert.match(dl, /mcSharePdfViaCapacitor_/);
  assert.match(dl, /mcToastPdfOk_/);
  const arm = extractFn(html, 'mcArmPdfTab', ['mcVisorUrl', 'mcIsIosNativeApp']);
  // mcArmPdfTab comes after helpers now; extract until next function after it
});

class FakeEl {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = String(tag || 'div').toUpperCase();
    this.style = {};
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.id = '';
    this.className = '';
    this.href = '';
    this.target = '';
    this.rel = '';
    this.download = '';
    this.src = '';
    this.type = 'button';
    this.textContent = '';
    this._innerHTML = '';
    this.onclick = null;
    this.parentNode = null;
    this.offsetHeight = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    if (c.id) this.ownerDocument._byId[c.id] = c;
    return c;
  }
  remove() {
    if (this.id) delete this.ownerDocument._byId[this.id];
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
      this.parentNode = null;
    }
  }
  addEventListener(t, fn) {
    (this.listeners[t] || (this.listeners[t] = [])).push(fn);
  }
  click() {
    const ev = { preventDefault() { ev.prevented = true; }, prevented: false };
    if (typeof this.onclick === 'function') this.onclick(ev);
    for (const fn of this.listeners.click || []) fn(ev);
  }
  set innerHTML(s) {
    this._innerHTML = String(s);
    const doc = this.ownerDocument;
    const re = /<(button|a|div|b|iframe|span)\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(this._innerHTML))) {
      const attrs = m[2];
      const idm = /\bid=["']([^"']+)["']/.exec(attrs);
      if (!idm) continue;
      const el = new FakeEl(doc, m[1]);
      el.id = idm[1];
      el.setAttribute('id', idm[1]);
      const hm = /\bhref=["']([^"']*)["']/.exec(attrs);
      if (hm) el.href = hm[1];
      const rest = this._innerHTML.slice(m.index);
      const close = rest.search(/<\//);
      if (close > 0) el.textContent = rest.slice(m[0].length, close).replace(/<[^>]+>/g, '').trim();
      doc._byId[el.id] = el;
      this.appendChild(el);
    }
  }
  get innerHTML() { return this._innerHTML; }
  get childElementCount() { return this.children.length; }
}

function makeDom() {
  const byId = Object.create(null);
  const body = { children: [], _byId: byId, appendChild(c) { this.children.push(c); c.parentNode = this; if (c.id) byId[c.id] = c; return c; } };
  const head = { appendChild() {} };
  const document = {
    _byId: byId,
    body,
    head,
    documentElement: { style: {} },
    createElement(tag) { return new FakeEl(document, tag); },
    getElementById(id) { return byId[id] || null; },
    querySelectorAll() { return []; },
  };
  body.ownerDocument = document;
  return document;
}

function loadHelpers(opts) {
  const ua = opts.ua;
  const opens = [];
  const assigns = [];
  const toasts = [];
  const fetches = [];
  const shares = [];
  const writes = [];
  const anchors = [];
  const document = makeDom();
  const navigator = {
    userAgent: ua,
    maxTouchPoints: opts.touch || 0,
    share: opts.navShare || undefined,
    canShare: opts.canShare || undefined,
  };
  const location = { href: 'https://portal.minecore.ec/#rutas', hash: '#rutas', hostname: 'portal.minecore.ec', assign(u) { assigns.push(String(u)); location.href = String(u); } };
  const windowObj = {
    document,
    navigator,
    location,
    Capacitor: opts.capacitor,
    MCA4: undefined,
    MC_SB_URL: 'https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/portal-api',
    open(url, target) { opens.push({ url, target }); return opts.openWin !== undefined ? opts.openWin : { closed: false, document: { open() {}, write() {}, close() {}, getElementById() { return null; }, title: '' }, location: { replace() {}, href: '' }, navigator: {}, setTimeout, File: globalThis.File }; },
    toast(msg) { toasts.push(String(msg)); },
  };
  windowObj.window = windowObj;
  function FileReader() {
    this.result = '';
    this.onload = null;
    this.onerror = null;
    this.error = null;
  }
  FileReader.prototype.readAsDataURL = function (blob) {
    const self = this;
    Promise.resolve(blob.arrayBuffer()).then((buf) => {
      self.result = 'data:application/pdf;base64,' + Buffer.from(buf).toString('base64');
      if (self.onload) self.onload();
    }).catch((e) => { self.error = e; if (self.onerror) self.onerror(); });
  };
  const fetchFn = function (url, init) {
    fetches.push({ url: String(url), body: init && init.body });
    const resp = opts.fetchResp || { ok: true, url: 'https://bklbvwpkrdaojbezljsd.supabase.co/storage/v1/object/sign/portal-tmp/TEST/abc.pdf?token=test' };
    return Promise.resolve({ json: async () => resp, ok: true, status: 200, text: async () => JSON.stringify(resp) });
  };
  const names = [
    'mcIsNativeApp', 'mcSanitizeFilename', 'mcIsIOS', 'mcHasDownloadAttr',
    'mcIsIosNativeApp', 'mcCapacitorPdfPlugins_', 'mcBlobToBase64_', 'mcToastPdfOk_',
    'mcSharePdfViaCapacitor_', 'mcUploadPdfTmp_', 'mcLoadPdfJsForIos_', 'mcRenderPdfPreview_',
    'mcOpenSignedPdf_', 'mcShowIosPdfPanel_', 'mcArmPdfTab', 'mcClosePdfTab_',
    'mcDownloadViaAnchor_', 'mcBlobFrom_', 'mcOpenPdfTab_', 'mcPdfSaveSheet_', 'mcDownloadBlob',
  ];
  // Pull a contiguous slice from first to last needed fn
  const start = html.indexOf('function mcIsNativeApp()');
  const mid = html.indexOf('function mcIsIosNativeApp()');
  const blobFrom = html.indexOf('function mcBlobFrom_');
  const dl = html.indexOf('function mcDownloadBlob(');
  const after = html.indexOf('\nvar MC_C128', dl);
  // mcSanitizeFilename / mcIsIOS sit between nativeApp and helpers; include that region
  const sani = html.indexOf('function mcSanitizeFilename(');
  const closeTab = html.indexOf('function mcClosePdfTab_(');
  const code = [
    html.slice(start, html.indexOf('\nfunction mcPortalCanon', start)),
    html.slice(sani, html.indexOf('\n/* b680', html.indexOf('function mcArmPdfTab'))),
    html.slice(closeTab, after),
  ].join('\n');
  const ctx = {
    window: windowObj,
    document,
    navigator,
    location,
    Capacitor: opts.capacitor,
    toast: windowObj.toast,
    MCsbTok: async () => ({ ok: true, sbt: 'test-token' }),
    MC_SB_URL: windowObj.MC_SB_URL,
    Promise, Date, Math, String, Number, Boolean, Array, Object, Error, Uint8Array,
    parseFloat, parseInt, isNaN, isFinite, undefined,
    setTimeout: function(fn, ms){ if((ms||0)>100) return 0; return setTimeout(fn, ms); },
    clearTimeout, console,
    encodeURIComponent, decodeURIComponent,
    Blob: globalThis.Blob,
    File: globalThis.File,
    FileReader,
    URL: {
      createObjectURL(b) { return 'blob:fake-' + (b && b.size || 0); },
      revokeObjectURL() {},
    },
    fetch: fetchFn,
    atob, btoa, Buffer,
  };
  ctx.window = windowObj;
  createContext(ctx);
  runInContext(code, ctx, { filename: 'ios-pdf-helpers.js' });
  // hook anchor click tracking
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'a') {
      const origClick = el.click.bind(el);
      el.click = function () { anchors.push({ href: el.href, download: el.download }); origClick(); };
    }
    return el;
  };
  return { ctx, window: windowObj, document, opens, assigns, toasts, fetches, shares, writes, anchors, navigator };
}

function pdfBlob() {
  return new Blob(['%PDF-1.4\n% test\n'], { type: 'application/pdf' });
}

const IPHONE_CAP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Capacitor/8.0.0';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

test('app iOS sin plugins Share/Filesystem: panel + Abrir PDF, no toast, ignora window.open fantasma', async () => {
  const env = loadHelpers({
    ua: IPHONE_CAP,
    touch: 5,
    capacitor: { isNativePlatform: () => true, Plugins: { App: {}, Network: {}, StatusBar: {} } },
    openWin: { closed: false, document: { open() {}, write() {}, close() {}, getElementById() { return null; } }, location: { replace() {}, href: '' } },
  });
  assert.equal(env.ctx.mcIsIosNativeApp(), true);
  assert.equal(env.ctx.mcArmPdfTab(), null);
  const r = await env.ctx.mcDownloadBlob(pdfBlob(), 'rutas-28-sep-31-oct-2026.pdf', 'application/pdf', null);
  assert.equal(r && r.via, 'panel');
  assert.equal(r && r.opened, false);
  const panel = env.document.getElementById('mc-pdf-ios');
  assert.ok(panel, 'debe mostrarse el visor en la misma pantalla');
  const openA = env.document.getElementById('mc-pdf-ios-open');
  const back = env.document.getElementById('mc-pdf-ios-back');
  assert.ok(openA && back);
  assert.match(back.textContent, /Volver/);
  assert.match(openA.textContent, /Abrir PDF/);
  assert.equal(env.toasts.some((t) => /PDF listo/.test(t)), false, 'no debe decir listo antes de abrir');
  // window.open pudo llamarse en otro código; mcDownloadBlob no debe usarlo como éxito
  // Esperar el upload (microtasks)
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(env.fetches.length >= 1);
  assert.match(String(env.fetches[0].body), /"action":"pdf_tmp"/);
  assert.ok(openA.href.includes('object/sign/portal-tmp'));
  openA.click();
  assert.ok(env.assigns.length === 1);
  assert.match(env.assigns[0], /object\/sign\/portal-tmp/);
  assert.ok(env.toasts.some((t) => t.includes('✓ PDF listo')));
});

test('app iOS con plugins Filesystem+Share: escribe en Cache y comparte, toast solo al lograrlo', async () => {
  const writes = [];
  const shares = [];
  const env = loadHelpers({
    ua: IPHONE_CAP,
    touch: 5,
    capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        Filesystem: {
          async writeFile(opts) { writes.push(opts); return { uri: 'file:///cache/' + opts.path }; },
        },
        Share: {
          async share(opts) { shares.push(opts); return {}; },
        },
      },
    },
  });
  const r = await env.ctx.mcDownloadBlob(pdfBlob(), 'caja-chica.pdf', 'application/pdf', null);
  assert.equal(r && r.ok, true);
  assert.equal(r && r.via, 'capacitor');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].directory, 'CACHE');
  assert.match(writes[0].path, /caja-chica\.pdf$/);
  assert.ok(writes[0].data && writes[0].data.length > 10);
  assert.equal(shares.length, 1);
  assert.equal(shares[0].files.length, 1);
  assert.equal(String(shares[0].files[0]), 'file:///cache/minecore-pdf/caja-chica.pdf');
  assert.ok(env.toasts.some((t) => t.includes('✓ PDF listo')));
  assert.equal(env.document.getElementById('mc-pdf-ios'), null, 'no hace falta el panel si Share abrió');
  assert.equal(env.assigns.length, 0);
});

test('escritorio y Android siguen por <a download>, sin panel iOS', async () => {
  for (const ua of [DESKTOP, ANDROID]) {
    const env = loadHelpers({ ua, touch: 0, capacitor: undefined });
    assert.equal(env.ctx.mcIsIosNativeApp(), false);
    const r = await env.ctx.mcDownloadBlob(pdfBlob(), 'corte.pdf', 'application/pdf', null);
    assert.equal(r && r.via, 'anchor');
    assert.equal(env.document.getElementById('mc-pdf-ios'), null);
    assert.ok(env.anchors.length >= 1);
    assert.equal(env.anchors[0].download, 'corte.pdf');
    assert.equal(env.toasts.length, 0);
    assert.equal(env.fetches.length, 0);
  }
});
