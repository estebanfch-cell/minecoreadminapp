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
    '@media(max-width:420px){.etiq-acts .cbz-btn,.etiq-acts .chip,.etiq-acts .etiq-retry,.etiq-acts .etiq-reprint{flex:1 1 100%}}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function permisos(modulos) {
    var m = modulos || [];
    if (m.indexOf(PERM) < 0) return false;
    return m.some(function (x) { return PREP.test(x) || FINE.test(x); });
  }
  function ok() {
    try {
      var P = root.getProfile ? root.getProfile() : null;
      if (!P) return false;
      if (P.rol === 'cliente' || P.rol === 'proveedor') return false;
      if (typeof root.mcEsCliV === 'function' && root.mcEsCliV()) return false;
      return permisos(P.modulos);
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
    var n = info.n != null ? info.n : '';
    var id = info.job_id ? ' ' + info.job_id : '';
    var cups = info.cups_job_id ? ' ' + info.cups_job_id : '';
    if (st === 'aviso') return 'Perfil Clientes · 19×51 mm (30330) · DYMO LabelWriter Wireless. No usa la DYMO 450 de bodega. ' + (n === '' ? '' : n + ' etiqueta(s), una por línea. ') + 'Si el servicio aún no deja pasar la orden, no se envía nada y la orden no cambia.';
    if (st === 'servicio_no_publicado') return 'No se envió ningún trabajo. La cola no está publicada en el servidor y el puente del iMac de bodega no está instalado. No está impreso. El stock y la preparación no cambian.';
    if (st === 'sin_permiso') return 'No tienes el permiso de imprimir etiquetas. Hay que encenderlo en Usuarios para esta persona.';
    if (st === 'ov_ajena') return 'No puedes imprimir etiquetas de esta orden.';
    if (st === 'puente_desconectado') return 'Trabajo en la cola de Minecore' + id + '. El puente del iMac de bodega no está conectado. No se envió a la impresora.';
    if (st === 'impresora_offline') return 'El puente está conectado, pero la DYMO LabelWriter Wireless figura offline. El trabajo sigue en cola y no se mandó a CUPS.';
    if (st === 'error_envio') return 'La impresora no aceptó el envío' + id + '. No quedó confirmado en CUPS. El reintento es seguro: no hay una copia a medias.';
    if (st === 'aceptado_cups') return 'CUPS aceptó el trabajo' + cups + '. Eso no confirma que la etiqueta haya salido. Revisa la impresora.';
    if (st === 'ambiguo') return 'El envío a CUPS quedó incierto' + id + '. No se reimprime solo. Si hace falta, revisa la impresora y usa el reintento explícito: puede salir una segunda etiqueta.';
    if (st === 'en_cola') return 'Trabajo en cola' + id + '. Todavía no se envía a la impresora.';
    if (st === 'entrada_rechazada') return 'La solicitud trae datos que no se aceptan. No se creó un trabajo.';
    return 'No se envió ningún trabajo.';
  }
  function tone(st) {
    if (st === 'error_envio' || st === 'sin_permiso' || st === 'ov_ajena' || st === 'entrada_rechazada') return 'bad';
    if (st === 'aviso') return '';
    return 'warn';
  }
  function actions(st) {
    var h = '<div class="etiq-acts"><button type="button" class="cbz-btn" onclick="MCEtiq.click(this)">Imprimir etiquetas</button>' +
      '<button type="button" class="chip" onclick="MCEtiq.pdf(this)">PDF 19×51 en este equipo</button>';
    if (st === 'ambiguo') h += '<button type="button" class="etiq-retry" onclick="MCEtiq.retry(this)">Reintentar envío incierto</button>';
    if (st === 'error_envio') h += '<button type="button" class="etiq-retry" onclick="MCEtiq.retry(this)">Reintentar envío</button>';
    if (st === 'aceptado_cups') h += '<button type="button" class="etiq-reprint" onclick="MCEtiq.reprint(this)">Reimprimir</button>';
    h += '</div>';
    if (st === 'aceptado_cups') h += '<div class="etiq-help">Reimprimir es voluntario: pide otra etiqueta. No es un reintento de un envío dudoso.</div>';
    if (st === 'ambiguo') h += '<div class="etiq-help">Reintentar envío incierto no es una reimpresión. Úsalo solo después de mirar la impresora.</div>';
    return h;
  }
  function boxHtml(model) {
    var st = model.state || 'aviso';
    return '<div class="etiq-box" data-ok="1" data-state="' + esc(st) + '" data-ctx="' + esc(model.ctx || '') + '" data-id="' + esc(model.id || '') + '" data-key="' + esc(model.key || '') + '" data-last="' + esc(model.last || '') + '">' +
      '<b>Etiquetas clientes</b>' + actions(st) +
      '<div class="etiq-meta">' + esc(model.order_number || '') + (model.cliente ? ' · ' + esc(model.cliente) : '') + '</div>' +
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
  function panel(o, ctx) {
    if (!ok()) return '';
    cssTag();
    var n = norm(o);
    CACHE[n.id] = n;
    var fp = n.lineas.map(function (l) { return l.sku + '|' + l.qty; }).join(',');
    return boxHtml({ state: 'aviso', ctx: ctx, id: n.id, order_number: n.order_number, cliente: n.cliente, n: n.lineas.length, key: 'print:' + n.id + ':' + fp });
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
      cups_job_id: d.cups_job_id
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
  var busy = {};
  function click(btn) {
    var box = btn && btn.closest ? btn.closest('.etiq-box') : null;
    if (!box) return decide({ permitted: false, live: false });
    var id = box.getAttribute('data-id') || '';
    var key = box.getAttribute('data-key') || '';
    if (!ok()) { paint(box, { state: 'sin_permiso', physically_printed: false }); return; }
    if (busy[key]) return;
    busy[key] = 1;
    box.setAttribute('data-last', key);
    post('etiq_status', { job_id: '00000000-0000-0000-0000-000000000000' }).then(function (probe) {
      if (!gatewayOpen(probe)) {
        busy[key] = 0;
        paint(box, { state: 'servicio_no_publicado', physically_printed: false });
        return null;
      }
      return post('etiq_enqueue', { ov_id: id, idempotency_key: key, intent: 'print' });
    }).then(function (r) {
      if (!r) return;
      busy[key] = 0;
      var box2 = root.document && root.document.querySelector('.etiq-box[data-id="' + id + '"]');
      paint(box2 || box, interpret(r));
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
  root.MCEtiq = {
    LIVE: false,
    gatewayOpen: gatewayOpen,
    PERM: PERM,
    CSS: CSS,
    permisos: permisos,
    ok: ok,
    panel: panel,
    decide: decide,
    interpret: interpret,
    texto: texto,
    boxHtml: boxHtml,
    click: click,
    retry: function (btn) { return blocked(btn, 'servicio_no_publicado'); },
    reprint: function (btn) { return blocked(btn, 'servicio_no_publicado'); },
    pdf: pdf,
    norm: norm
  };
})(typeof window !== 'undefined' ? window : globalThis);
