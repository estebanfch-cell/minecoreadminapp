/* Impresión remota. No hay LIVE fijo: se pregunta al gateway y solo se encola
   si responde el contrato etiq. Si portal-api todavía filtra la operación, no se envía nada. */
(function (root) {
  'use strict';
  var LIVE = false;
  var PERM = '~prep.e.etiq=1';
  var PREP = /^(inventario|cotizaciones|picking|entrega)\+?$/;
  var FINE = /^@(picking|entrega|inventario|ventas)=[123]$/;
  var CACHE = {};
  var CSS = '.etiq-box{box-sizing:border-box;margin:10px 0;padding:10px 12px;border:1px solid #26405c;border-radius:10px;background:#0f1a26;max-width:100%}' +
    '.etiq-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}.etiq-acts .cbz-btn,.etiq-acts .chip,.etiq-acts .etiq-retry,.etiq-acts .etiq-reprint{min-height:40px;box-sizing:border-box}' +
    '.etiq-meta,.etiq-st,.etiq-help{overflow-wrap:anywhere;word-break:break-word}.etiq-meta{font-size:12px;color:#8fa3b8;margin:6px 0}' +
    '.etiq-st{margin-top:8px;font-size:13px;line-height:1.4;color:#dce6f0}.etiq-st.warn{color:#f0c040}.etiq-st.bad{color:#ff9a9a}' +
    '.etiq-retry{background:#3a2e00;color:#f0c040;border:1px solid #f0c040;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}' +
    '.etiq-reprint{background:#1c2a3a;color:#dce6f0;border:1px solid #2e4257;border-radius:8px;padding:8px 12px;cursor:pointer}' +
    '.etiq-help{font-size:11.5px;color:#8fa3b8;margin-top:4px}' +
    '.etiq-remote{flex:1 1 100%;max-width:100%;box-sizing:border-box;text-align:center;white-space:nowrap}' +
    '.etiq-count{font-size:12px;color:#8fa3b8;margin-top:4px;min-height:0}' +
    '.etiq-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:etiqsp .7s linear infinite;vertical-align:-2px}' +
    '@keyframes etiqsp{to{transform:rotate(360deg)}}' +
    '@media(max-width:420px){.etiq-acts .cbz-btn,.etiq-acts .chip,.etiq-acts .etiq-retry,.etiq-acts .etiq-reprint{flex:1 1 100%}}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function permisos(modulos, rol) {
    var m = modulos || [];
    if (m.indexOf(PERM) < 0) return false;
    if (rol === 'admin') return true;
    return m.some(function (x) { return PREP.test(x) || FINE.test(x); });
  }
  function ok() {
    try {
      var P = root.getProfile ? root.getProfile() : null;
      if (!P) return false;
      if (P.rol === 'cliente' || P.rol === 'proveedor') return false;
      if (typeof root.mcEsCliV === 'function' && root.mcEsCliV()) return false;
      return permisos(P.modulos, P.rol);
    } catch (e) { return false; }
  }
  function norm(o) {
    o = o || {};
    var lines = (o.lineas || []).filter(function (l) {
      return l && l.item_type !== 'service' && (l.sku || l.nombre);
    }).map(function (l) {
      var q = l.cantidad != null ? l.cantidad : (l.pendiente != null ? l.pendiente : l.quantity);
      return { sku: String(l.sku || ''), nombre: String(l.nombre || l.description || ''), qty: q };
    }).filter(function (l) { return Number(l.qty) > 0; });
    return { id: String(o.id || o.so || ''), order_number: String(o.order_number || ''), cliente: String(o.cliente || ''), lineas: lines };
  }
  function texto(st, info) {
    info = info || {};
    if (st === 'servicio_no_publicado' && info.vincular) return 'No se obtuvo el código. El servidor no aceptó la solicitud. No se vinculó el iMac y no se imprimió nada.';
    if (st === 'en_cola' || st === 'puente_desconectado' || st === 'impresora_offline') return 'En cola';
    if (st === 'ambiguo') return 'Sin confirmar';
    if (st === 'aceptado_cups') return 'Enviada a impresora';
    if (st === 'sin_permiso') return 'Sin permiso';
    if (st === 'aviso' || st === 'espera') return '';
    return 'Error';
  }
  function tone(st) {
    if (st === 'error_envio' || st === 'sin_permiso' || st === 'ov_ajena' || st === 'entrada_rechazada' || st === 'servicio_no_publicado') return 'bad';
    if (st === 'aviso' || st === 'espera' || st === 'aceptado_cups') return '';
    return 'warn';
  }
  function boxHtml(model) {
    var st = model.state || 'aviso';
    var n = typeof model.enviadas === 'number' ? String(model.enviadas) : '';
    return '<div class="etiq-box" data-ok="1" data-state="' + esc(st) + '" data-ctx="' + esc(model.ctx || '') + '" data-id="' + esc(model.id || '') + '" data-key="' + esc(model.key || '') + '">' +
      '<div class="etiq-acts"><button type="button" class="chip etiq-remote" onclick="MCEtiq.click(this)">Imprimir etiquetas remotas</button>' +
      '<button type="button" class="chip" onclick="MCEtiq.pdf(this)">PDF 19×51 en este equipo</button></div>' +
      '<div class="etiq-count">' + (n === '' ? '' : 'Enviadas a impresora ' + esc(n)) + '</div>' +
      '<div class="etiq-st ' + tone(st) + '">' + esc(texto(st, model)) + '</div></div>';
  }
  function cssTag() {
    try {
      if (!root.document || root.document.getElementById('etiq-css')) return;
      var s = root.document.createElement('style');
      s.id = 'etiq-css';
      s.textContent = CSS;
      root.document.head.appendChild(s);
    } catch (e) {}
  }
  function impresionHtml(model) {
    model = model || {};
    if (!ok() && model.state !== 'sin_permiso') return '';
    cssTag();
    var st = model.state || 'listo';
    var code = model.code ? '<div class="etiq-st etiq-code">Código para el instalador. Vale 10 minutos. Escríbelo en el iMac y no lo mandes por chat: <b>' + esc(model.code) + '</b></div>' : '';
    var msg = st === 'listo'
      ? 'El iMac que ya está vinculado sigue igual. Pide un código solo para vincular una Mac nueva. No aparece hasta que lo pidas.'
      : texto(st === 'aviso' ? 'servicio_no_publicado' : st, { vincular: true });
    if (st === 'aviso' && model.code) msg = 'Úsalo en el instalador de esa Mac. El puente que ya está cargado no se revoca.';
    return '<div class="etiq-box etiq-vinc" data-ok="1" data-id="vincular" data-state="' + esc(st) + '">' +
      '<div class="etiq-acts"><button type="button" class="cbz-btn" onclick="MCEtiq.pair(this)">Código para el iMac</button></div>' +
      code + '<div class="etiq-st ' + tone(st === 'listo' ? 'aviso' : st) + '">' + esc(msg) + '</div></div>';
  }
  function impresion() { return impresionHtml(); }
  function entero(v, min, max) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d+$/.test(s)) return null;
    var n = parseInt(s, 10);
    if (n < min || n > max) return null;
    return n;
  }
  function uuidOk(v) { return /^[0-9a-f-]{36}$/i.test(String(v || '')); }
  function ov() { return ''; }
  function pasoMs() {
    var n = root.MCEtiq && root.MCEtiq._paso;
    return n > 0 ? n : 2000;
  }
  function estadoRes(r) {
    if (!r || typeof r !== 'object') return 'servicio_no_publicado';
    var err = String(r.error || '');
    if (/operaci[oó]n no v[aá]lida/i.test(err)) return 'servicio_no_publicado';
    if (err === 'sin_permiso' || r.code === 'sin_permiso') return 'sin_permiso';
    if (err === 'entrada_rechazada' || err === 'nada_que_imprimir' || err === 'ov_ajena') return 'entrada_rechazada';
    var d = interpret(r);
    if (d.state === 'aceptado_cups' || d.state === 'error_envio' || d.state === 'ambiguo') return d.state;
    if (r.job && (r.job.status === 'queued' || r.job.status === 'claimed')) return 'en_cola';
    if (d.state === 'en_cola' || d.state === 'puente_desconectado' || d.state === 'impresora_offline') return 'en_cola';
    return d.state || 'servicio_no_publicado';
  }
  function seguir(jobId, pintar) {
    var n = 0;
    return new Promise(function (resolve) {
      function tick() {
        n += 1;
        post('etiq_status', { job_id: jobId }).then(function (r) {
          var st = estadoRes(r);
          if (st === 'aceptado_cups' || st === 'error_envio' || st === 'ambiguo' || n >= 15) {
            resolve(st === 'aceptado_cups' || st === 'error_envio' || st === 'ambiguo' ? st : 'en_cola');
            return;
          }
          pintar('en_cola', true);
          setTimeout(tick, pasoMs());
        });
      }
      setTimeout(tick, pasoMs());
    });
  }
  function marcar(el, st, vivo) {
    if (!el) return;
    el.className = 'etiq-st' + (tone(st) ? ' ' + tone(st) : '');
    if (vivo) el.innerHTML = '<span class="etiq-spin"></span> ' + esc(texto(st));
    else el.textContent = texto(st);
  }
  function girar(btn, on, etiqueta) {
    if (!btn) return;
    if (on) {
      btn.disabled = true;
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent || etiqueta || '');
      btn.innerHTML = '<span class="etiq-spin"></span>';
    } else {
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-label') || etiqueta || 'Imprimir etiqueta remota';
    }
  }
  function leerCuenta(r) {
    if (!r || r.etiq !== 1 || r.physically_printed !== false || r.cuenta !== 'enviadas_a_impresora') return null;
    var n = r.enviadas;
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
    return n;
  }
  function pedirCuenta(el, extra) {
    if (!el) return Promise.resolve(null);
    return post('etiq_cuenta', extra).then(function (r) {
      var n = leerCuenta(r);
      if (n == null) return null;
      el.textContent = 'Enviadas a impresora ' + n;
      return n;
    });
  }
  function hostProd() {
    var host = root.document && root.document.getElementById('etiq-prod');
    if (!host) return null;
    if (!host.querySelector('.etiq-count')) host.innerHTML = '<div class="etiq-count"></div><div class="etiq-st"></div>';
    return host;
  }
  function despues(st, btn, etiqueta, el, cuentaEl, cuentaExtra) {
    girar(btn, false, etiqueta);
    marcar(el, st);
    if (st === 'aceptado_cups') return pedirCuenta(cuentaEl, cuentaExtra);
    return Promise.resolve(null);
  }
  function vigilar(r, pintar) {
    var st = estadoRes(r);
    var jobId = r && r.job && r.job.id;
    if (st === 'en_cola' && uuidOk(jobId)) {
      pintar('en_cola', true);
      return seguir(jobId, pintar);
    }
    return Promise.resolve(st);
  }
  function toda(cur) {
    if (!ok() || !cur || !cur.orden || cur.orden.is_quote || cur.orden.is_cancelled || !uuidOk(cur.orden.id)) return;
    var id = String(cur.orden.id);
    if (!cur._etiqNonce) cur._etiqNonce = String(Date.now());
    var key = 'all:' + id + ':' + cur._etiqNonce;
    if (busy[key]) return;
    busy[key] = 1;
    var host = root.document && root.document.getElementById('etiq-toda');
    var cuenta = root.document && root.document.getElementById('etiq-ov-n');
    marcar(host, 'espera', true);
    post('etiq_enqueue', { ov_id: id, idempotency_key: key }).then(function (r) {
      return vigilar(r, function (st, vivo) { marcar(host, st, vivo); });
    }).then(function (st) {
      busy[key] = 0;
      marcar(host, st);
      if (st === 'aceptado_cups') pedirCuenta(cuenta, { ov_id: id });
    });
  }
  function ver(id) {
    if (!ok() || !uuidOk(id)) return;
    var host = hostProd();
    if (!host) return;
    pedirCuenta(host.querySelector('.etiq-count'), { product_id: String(id) });
  }
  function verOv(id) {
    if (!ok() || !uuidOk(id)) return;
    var el = root.document && root.document.getElementById('etiq-ov-n');
    pedirCuenta(el, { ov_id: String(id) });
  }
  var claves = {};
  var busy = {};
  function directo(btn, id) {
    if (!ok()) return;
    id = String(id || '');
    if (!uuidOk(id)) return;
    var lock = 'prod:' + id;
    if (busy[lock]) return;
    busy[lock] = 1;
    if (!claves[id]) claves[id] = 'uno:' + id + '::1:1:' + Date.now();
    var host = hostProd();
    var stEl = host && host.querySelector('.etiq-st');
    var cuentaEl = host && host.querySelector('.etiq-count');
    girar(btn, true, 'Imprimir etiqueta remota');
    marcar(stEl, 'espera', true);
    post('etiq_enqueue', { copies: 1, qty_etiqueta: 1, idempotency_key: claves[id], product_id: id }).then(function (r) {
      var err = r && r.error ? String(r.error) : '';
      if (!r || err === 'entrada_rechazada' || err === 'nada_que_imprimir') delete claves[id];
      return vigilar(r, function (st, vivo) { marcar(stEl, st, vivo); });
    }).then(function (st) {
      busy[lock] = 0;
      return despues(st, btn, 'Imprimir etiqueta remota', stEl, cuentaEl, { product_id: id });
    });
  }
  function prod(id) { directo(null, id); }
  function panel(o, ctx) {
    if (!ok()) return '';
    cssTag();
    var n = norm(o);
    CACHE[n.id] = n;
    var fp = n.lineas.map(function (l) { return l.sku + '|' + l.qty; }).join(',');
    var id = n.id;
    if (uuidOk(id)) setTimeout(function () {
      var box = root.document && root.document.querySelector('.etiq-box[data-id="' + id + '"]');
      if (box) pedirCuenta(box.querySelector('.etiq-count'), { ov_id: id });
    }, 0);
    return boxHtml({ state: 'aviso', ctx: ctx, id: id, key: 'print:' + id + ':' + fp });
  }
  function decide(input) {
    if (!input.permitted) return { state: 'sin_permiso', sent: false, job_id: null, duplicate: false, physically_printed: false };
    if (input.forbidden) return { state: 'entrada_rechazada', sent: false, job_id: null, duplicate: false, physically_printed: false };
    if (!input.live) return { state: 'servicio_no_publicado', sent: false, job_id: null, duplicate: !!input.sameKey, physically_printed: false };
    return { state: 'pendiente_respuesta', sent: true, job_id: null, duplicate: false, physically_printed: false };
  }
  function gatewayOpen(res) {
    if (!res || typeof res !== 'object') return false;
    var err = String(res.error || '');
    if (/operaci[oó]n no v[aá]lida/i.test(err)) return false;
    if (res.etiq === 1 && res.physically_printed === false) return true;
    var code = String(res.code || '');
    return code === 'ov_ajena' || code === 'sin_permiso' || code === 'entrada_rechazada' || code === 'nada_que_imprimir' || code === 'confirma_reintento' || code === 'confirma_reimpresion' || code === 'no_reintento';
  }
  function post(op, extra) {
    if (typeof root.MCpost !== 'function') return Promise.resolve(null);
    var p = { action: 'ventas', op: op };
    try { p.user = root.getUserName ? root.getUserName() : ''; p.pin = root.getPin ? root.getPin() : ''; } catch (e) {}
    if (extra) for (var k in extra) p[k] = extra[k];
    return Promise.resolve(root.MCpost(p)).catch(function () { return null; });
  }
  function interpret(res) {
    if (!res || typeof res !== 'object') return { state: 'servicio_no_publicado', sent: false, physically_printed: false, job_id: null };
    var err = String(res.error || '');
    if (/operaci[oó]n no v[aá]lida/i.test(err)) return { state: 'servicio_no_publicado', sent: false, physically_printed: false, job_id: null };
    if (res.code === 'sin_permiso') return { state: 'sin_permiso', sent: false, physically_printed: false, job_id: null };
    if (res.code === 'ov_ajena') return { state: 'ov_ajena', sent: false, physically_printed: false, job_id: null };
    if (!res.ok || res.etiq !== 1 || res.physically_printed !== false) {
      return { state: 'servicio_no_publicado', sent: false, physically_printed: false, job_id: null };
    }
    var job = res.job || {};
    var st = 'servicio_no_publicado';
    if (job.status === 'accepted_by_cups') st = 'aceptado_cups';
    else if (job.status === 'send_error') st = 'error_envio';
    else if (job.status === 'ambiguous') st = 'ambiguo';
    else if (res.bridge === 'desconectado') st = 'puente_desconectado';
    else if (res.printer === 'offline') st = 'impresora_offline';
    else if (job.status === 'queued' || job.status === 'claimed') st = 'en_cola';
    return { state: st, sent: true, job_id: job.id || null, cups_job_id: job.cups_job_id || null, duplicate: !!res.duplicate, physically_printed: false };
  }
  function paint(box, d, extra) {
    if (!box) return;
    var id = box.getAttribute('data-id');
    var n = CACHE[id];
    var model = {
      state: d.state,
      ctx: box.getAttribute('data-ctx'),
      id: id,
      order_number: n ? n.order_number : '',
      cliente: n ? n.cliente : '',
      n: n ? n.lineas.length : null,
      key: box.getAttribute('data-key'),
      last: box.getAttribute('data-last'),
      job_id: d.job_id,
      cups_job_id: d.cups_job_id,
      code: d.code || ''
    };
    if (extra) for (var k in extra) model[k] = extra[k];
    var host = box.parentNode;
    var html = boxHtml(model);
    if (!host) return html;
    var wrap = root.document.createElement('div');
    wrap.innerHTML = html;
    host.replaceChild(wrap.firstChild, box);
    return html;
  }
  function click(btn) {
    var box = btn && btn.closest ? btn.closest('.etiq-box') : null;
    if (!box) return decide({ permitted: false, live: false });
    var id = box.getAttribute('data-id') || '';
    var key = box.getAttribute('data-key') || '';
    if (!ok()) { marcar(box.querySelector('.etiq-st'), 'sin_permiso'); return; }
    if (!uuidOk(id) || busy[key]) return;
    busy[key] = 1;
    girar(btn, true, 'Imprimir etiquetas remotas');
    marcar(box.querySelector('.etiq-st'), 'espera', true);
    post('etiq_enqueue', { ov_id: id, idempotency_key: key }).then(function (r) {
      return vigilar(r, function (st, vivo) { marcar(box.querySelector('.etiq-st'), st, vivo); });
    }).then(function (st) {
      busy[key] = 0;
      return despues(st, btn, 'Imprimir etiquetas remotas', box.querySelector('.etiq-st'), box.querySelector('.etiq-count'), { ov_id: id });
    });
  }
  function blocked(btn, state) {
    var box = btn && btn.closest ? btn.closest('.etiq-box') : null;
    var d = decide({ permitted: !!(box && box.getAttribute('data-ok') === '1' && ok()), live: false, sameKey: false, forbidden: false });
    d.state = state;
    if (box) paint(box, d);
    return d;
  }
  function pdf(btn) {
    var box = btn && btn.closest ? btn.closest('.etiq-box') : null;
    var o = box ? CACHE[box.getAttribute('data-id')] : null;
    if (!o || !root.MCDymo || typeof root.MCDymo.abrir !== 'function') {
      try { root.alert('El PDF de etiquetas no está disponible en esta pantalla.'); } catch (e) {}
      return;
    }
    var items = o.lineas.map(function (l) {
      return { sku: l.sku, nombre: l.nombre, qty: l.qty, ov: o.order_number, copias: 1 };
    });
    if (!items.length) {
      try { root.alert('No hay líneas para etiquetar.'); } catch (e2) {}
      return;
    }
    root.MCDymo.abrir('despacho', items, 'Etiquetas clientes · ' + o.order_number);
  }
  function replaceBox(box, html) {
    if (!box || !box.parentNode || !root.document) return;
    var wrap = root.document.createElement('div');
    wrap.innerHTML = html;
    if (wrap.firstChild) box.parentNode.replaceChild(wrap.firstChild, box);
  }
  function pair(btn) {
    var box = btn && btn.closest ? btn.closest('.etiq-box') : null;
    if (!box) return;
    var vinc = box.className.indexOf('etiq-vinc') >= 0;
    var id = box.getAttribute('data-id') || '';
    if (!ok()) {
      if (vinc) replaceBox(box, impresionHtml({ state: 'sin_permiso' }));
      else paint(box, { state: 'sin_permiso', physically_printed: false });
      return;
    }
    post('etiq_pair_begin', {}).then(function (r) {
      var sel = vinc ? '.etiq-vinc' : '.etiq-box[data-id="' + id + '"]';
      var host = (root.document && root.document.querySelector(sel)) || box;
      var err = r && r.error ? String(r.error) : '';
      var codigo = r && r.etiq === 1 && r.physically_printed === false && r.code && String(r.code) !== 'sin_permiso' ? String(r.code) : '';
      var malo = !codigo || /operaci[oó]n no v[aá]lida/i.test(err);
      if (vinc) {
        var st = r && r.code === 'sin_permiso' && !codigo ? 'sin_permiso' : (malo ? 'servicio_no_publicado' : 'aviso');
        replaceBox(host, impresionHtml({ state: st, code: malo ? '' : codigo }));
        return;
      }
      if (malo) { paint(host, { state: 'servicio_no_publicado', physically_printed: false }); return; }
      paint(host, { state: 'aviso', physically_printed: false, code: codigo });
    });
  }
  root.MCEtiq = {
    LIVE: false,
    gatewayOpen: gatewayOpen,
    PERM: PERM,
    CSS: CSS,
    permisos: permisos,
    ok: ok,
    panel: panel,
    impresion: impresion,
    ov: ov,
    toda: toda,
    prod: prod,
    directo: directo,
    ver: ver,
    verOv: verOv,
    leerCuenta: leerCuenta,
    estadoRes: estadoRes,
    decide: decide,
    interpret: interpret,
    texto: texto,
    boxHtml: boxHtml,
    click: click,
    retry: function (btn) { return blocked(btn, 'servicio_no_publicado'); },
    reprint: function (btn) { return blocked(btn, 'servicio_no_publicado'); },
    pdf: pdf,
    pair: pair,
    norm: norm
  };
})(typeof window !== 'undefined' ? window : globalThis);
