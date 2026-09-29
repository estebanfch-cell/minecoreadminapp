/**
 * AdminAPI_v129.gs — Caja Chica + Rutas nativo en la base Admin (Minecore Admin)
 * Version string: v129
 *
 * v129 (2026-09-29, portal index v220):
 *   - Anti-duplicado en crearEntrega / crearGasto / crearRuta: LockService + clave de
 *     idempotencia clientReqId (CacheService 6 h) + huella de contenido (mismo admin/usuario/
 *     monto/forma|categoría/descripción/foto en < 2 min ⇒ devuelve el ID existente, no inserta).
 *   - Fecha de Caja_Entregas / Caja_Gastos: fecha real (Date) con formato d/M/yyyy
 *     (America/Guayaquil), ya no texto ISO "2026-09-29T18:22:15.885Z".
 *   - Admin / Aprobado Por vía cajaWho_ (en v128 Admin quedaba vacío).
 *
 * NO reemplaza el motor Admin existente (hoy en vivo: v124). Pégalo como
 * ARCHIVO NUEVO en el proyecto de Apps Script del AdminAPI (portal.minecore.ec)
 * y aplica el cableado de PASTE_v128.md.
 *
 * Si el motor ya tiene un parche dueDate (v126) u otro arreglo posterior a v124,
 * no lo borres. Este archivo solo agrega Caja. La versión del doGet pasa a v128.
 *
 * Acciones nativas (mismos JSON que el Caja API viejo):
 *   getRutas, getGastos, getEntregas, getBalanceCaja, getConfig, updateConfig,
 *   crearRuta, editarRuta, aprobarRuta, rechazarRuta,
 *   crearGasto, aprobarGasto, rechazarGasto, crearEntrega,
 *   eliminarLineaCaja, eliminarEntrega, eliminarGasto, eliminarRuta,
 *   cerrarCorte, savePhoto, migrateCajaSheets
 *
 * Omitidas a propósito (EFCH lock): login, crearUsuario, editarUsuario, eliminarUsuario.
 *
 * Auth: sesión Admin únicamente (EFCH / Osvaldo / Secre). Sin PIN de Caja
 * y sin CRUD de usuarios Caja. Los movimientos se atribuyen a
 * user.usuario / user.nombre de esa sesión.
 *
 * Spreadsheets (orden fijo — el vivo primero):
 *   1. Vivo:  1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY
 *      Minecore App (Gmail). Compartir editor con estebanferlito@minecore.ec
 *   2. Copia opcional, NO preferida (foto 19-sep, puede estar vieja):
 *      1xHmpvXwuAvON4sw7D4ou92zszThXFHKdzUcoJ__71hA
 *   Destino Admin DB: 1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY
 *      Minecore - Datos inFlow
 *
 * Pestañas: Rutas, Gastos/CajaGastos, Entregas/CajaEntregas, Config, Cortes
 * → Caja_Rutas, Caja_Gastos, Caja_Entregas, Caja_Config, Caja_Cortes.
 * Usuarios / PIN no se copian.
 *
 * migrateCajaSheets es idempotente (no pisa destino con filas).
 * migrateCajaSheetsForceFromLive lee SOLO el libro vivo y sí pisa.
 */

var CAJA_API_VERSION = 'v129';
var CAJA_TZ = 'America/Guayaquil';
var CAJA_DATE_FMT = 'd/M/yyyy';
var CAJA_DUP_WINDOW_S = 120;
var CAJA_SOURCE_LIVE_ID = '1cLXYvJCrXY3kt9yccBKgnY7g5SYdeMrWShBSXjC_kPM'; // copia viva 2026-09-28 (writer minecore.ec); original 1TBkb… si se comparte
var CAJA_SOURCE_COPY_ID = '1xHmpvXwuAvON4sw7D4ou92zszThXFHKdzUcoJ__71hA';
var CAJA_ADMIN_DB_FALLBACK = '1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY';
var CAJA_SKIP_SOURCE_TABS = { USUARIOS: 1, USERS: 1, PIN: 1 };
var CAJA_SESSION_ALLOW = { efch: 1, osvaldo: 1, oswaldo: 1, secre: 1 };

/** Source tab → dest Caja_* (verified Minecore App: Rutas / Gastos / Entregas / Config). */
var CAJA_DEST_MAP = {
  Rutas: 'Caja_Rutas',
  Gastos: 'Caja_Gastos',
  CajaGastos: 'Caja_Gastos',
  Entregas: 'Caja_Entregas',
  CajaEntregas: 'Caja_Entregas',
  Config: 'Caja_Config',
  Cortes: 'Caja_Cortes',
  Corte: 'Caja_Cortes'
};
var CAJA_SHEET_ALIASES = {
  Rutas: ['Caja_Rutas', 'Rutas'],
  Gastos: ['Caja_Gastos', 'Gastos', 'CajaGastos'],
  Entregas: ['Caja_Entregas', 'Entregas', 'CajaEntregas'],
  Config: ['Caja_Config', 'Config'],
  Cortes: ['Caja_Cortes', 'Cortes', 'Corte']
};

var CAJA_READ = {
  getRutas: 1, getGastos: 1, getEntregas: 1, getBalanceCaja: 1, getConfig: 1
};
var CAJA_WRITE = {
  updateConfig: 1, crearRuta: 1, editarRuta: 1, aprobarRuta: 1, rechazarRuta: 1,
  crearGasto: 1, aprobarGasto: 1, rechazarGasto: 1, crearEntrega: 1,
  eliminarLineaCaja: 1, eliminarEntrega: 1, eliminarGasto: 1, eliminarRuta: 1,
  cerrarCorte: 1, savePhoto: 1, migrateCajaSheets: 1
};

var CAJA_HEADERS = {
  Rutas: ['ID', 'Fecha Solicitud', 'Fecha Servicio', 'Usuario', 'Origen', 'Destino', 'KM', 'Tipo', 'Motivo', 'Estado', 'Valor ($)', 'Fecha Aprobacion', 'Aprobado Por', 'Notas', 'Periodo', 'Vehiculo'],
  Gastos: ['ID', 'Fecha', 'Usuario', 'Monto ($)', 'Categoria', 'Descripcion', 'Foto URL', 'Estado', 'Aprobado Por', 'Fecha Aprobacion', 'Periodo'],
  Entregas: ['ID', 'Fecha', 'Admin', 'Usuario Destino', 'Monto ($)', 'Forma', 'Descripcion', 'Foto URL', 'Periodo'],
  Config: ['Clave', 'Valor', 'Descripcion'],
  Cortes: ['ID', 'Periodo', 'Fecha', 'Total KM', 'Total USD', 'Rutas', 'Admin', 'Estado']
};

var CAJA_CONFIG_SEED = [
  ['precio_km', '0.40', 'Precio por km en USD'],
  ['corte_dia_inicio', '26', 'Dia inicio periodo'],
  ['corte_dia_fin', '25', 'Dia fin periodo']
];

var CAJA_NAME_HINTS = {
  EFCH: 'Esteban Ferlito',
  MPL: 'Martín Pinto',
  OPM: 'Oswaldo Peña',
  AG: 'Ángel Guachamin',
  SECRE: 'SECRE Conta',
  Osvaldo: 'Oswaldo Peña',
  Secre: 'SECRE Conta'
};

/** Dispatcher: llámalo desde doPost DESPUÉS de autenticar. Devuelve ContentService output o null. */
function cajaDispatch_(p, user) {
  p = p || {};
  var action = String(p.action || '');
  if (!CAJA_READ[action] && !CAJA_WRITE[action]) return null;
  if (!user) user = cajaAuth_(p);
  if (!user) return cajaJson_({ ok: false, error: 'Sesión Admin requerida (EFCH / Osvaldo / Secre)' });
  if (!cajaAllowedSession_(user)) {
    return cajaJson_({ ok: false, error: 'Caja solo para sesión Admin EFCH / Osvaldo / Secre' });
  }
  if (!cajaCanView_(user)) return cajaJson_({ ok: false, error: 'Sin permiso del módulo Caja' });
  if (CAJA_WRITE[action] && !cajaCanWrite_(user, action)) {
    return cajaJson_({ ok: false, error: 'Se requiere permiso caja+ o admin para esta acción' });
  }
  try {
    var out;
    if (action === 'getRutas') out = cajaGetRutas_(p, user);
    else if (action === 'getGastos') out = cajaGetGastos_(p, user);
    else if (action === 'getEntregas') out = cajaGetEntregas_(p, user);
    else if (action === 'getBalanceCaja') out = cajaGetBalance_(p, user);
    else if (action === 'getConfig') out = cajaGetConfig_(p, user);
    else if (action === 'updateConfig') out = cajaUpdateConfig_(p, user);
    else if (action === 'crearRuta') out = cajaCrearRuta_(p, user);
    else if (action === 'editarRuta') out = cajaEditarRuta_(p, user);
    else if (action === 'aprobarRuta') out = cajaAprobarRuta_(p, user);
    else if (action === 'rechazarRuta') out = cajaRechazarRuta_(p, user);
    else if (action === 'crearGasto') out = cajaCrearGasto_(p, user);
    else if (action === 'aprobarGasto') out = cajaAprobarGasto_(p, user);
    else if (action === 'rechazarGasto') out = cajaRechazarGasto_(p, user);
    else if (action === 'crearEntrega') out = cajaCrearEntrega_(p, user);
    else if (action === 'eliminarLineaCaja') out = cajaEliminarLinea_(p, user);
    else if (action === 'eliminarEntrega') { p.tipo = 'entrega'; out = cajaEliminarLinea_(p, user); }
    else if (action === 'eliminarGasto') { p.tipo = 'gasto'; out = cajaEliminarLinea_(p, user); }
    else if (action === 'eliminarRuta') { p.tipo = 'ruta'; out = cajaEliminarLinea_(p, user); }
    else if (action === 'cerrarCorte') out = cajaCerrarCorte_(p, user);
    else if (action === 'savePhoto') out = cajaSavePhoto_(p, user);
    else if (action === 'migrateCajaSheets') out = cajaMigrateSheets_(p, user);
    else return null;
    return cajaJson_(out);
  } catch (e) {
    return cajaJson_({ ok: false, error: String(e && e.message || e) });
  }
}

/** Corre desde el editor: migrateCajaSheets() — idempotente. Vivo primero; copia 19-sep solo si el vivo no abre. */
function migrateCajaSheets() {
  var fakeAdmin = { usuario: 'EFCH', nombre: 'Esteban Ferlito', rol: 'admin', modulos: ['caja+'] };
  var res = cajaMigrateSheets_({}, fakeAdmin);
  Logger.log(JSON.stringify(res));
  return res;
}

/**
 * Una sola vez para esta migración: lee SIEMPRE el Minecore App vivo
 * (1TBkb…) y pisa Caja_* aunque ya tengan filas. No usa la copia del 19-sep.
 */
function migrateCajaSheetsForceFromLive() {
  var fakeAdmin = { usuario: 'EFCH', nombre: 'Esteban Ferlito', rol: 'admin', modulos: ['caja+'] };
  var res = cajaMigrateSheets_({ force: true, liveOnly: true }, fakeAdmin);
  Logger.log(JSON.stringify(res));
  return res;
}

function cajaOpenSourceSs_(opts) {
  opts = opts || {};
  var ids = opts.liveOnly ? [CAJA_SOURCE_LIVE_ID] : [CAJA_SOURCE_LIVE_ID, CAJA_SOURCE_COPY_ID];
  var lastErr = '';
  for (var i = 0; i < ids.length; i++) {
    try {
      var ss = SpreadsheetApp.openById(ids[i]);
      return {
        ss: ss,
        id: ids[i],
        title: ss.getName(),
        usedFallback: i > 0,
        liveOnly: !!opts.liveOnly,
        staleCopy: ids[i] === CAJA_SOURCE_COPY_ID
      };
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  if (opts.liveOnly) {
    throw new Error(
      'No se pudo abrir el Minecore App vivo ' + CAJA_SOURCE_LIVE_ID +
      '. Compartilo como editor con estebanferlito@minecore.ec y volvé a correr migrateCajaSheetsForceFromLive. ' +
      lastErr
    );
  }
  throw new Error(
    'No se pudo abrir el Minecore App vivo ' + CAJA_SOURCE_LIVE_ID +
    ' ni la copia opcional ' + CAJA_SOURCE_COPY_ID +
    '. La copia del 19-sep no es la fuente. Compartí el vivo como editor con estebanferlito@minecore.ec. ' +
    lastErr
  );
}

function inspectCajaSource() {
  var opened = cajaOpenSourceSs_();
  var tabs = opened.ss.getSheets().map(function (sh) {
    var lastCol = sh.getLastColumn();
    var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || ''); }) : [];
    return { name: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1), headers: headers };
  });
  var res = {
    ok: true,
    sourceId: opened.id,
    title: opened.title,
    preferredLiveId: CAJA_SOURCE_LIVE_ID,
    usedFallback: opened.usedFallback,
    staleCopy: !!opened.staleCopy,
    warning: opened.staleCopy ? 'Se usó la copia del 19-sep. El vivo es ' + CAJA_SOURCE_LIVE_ID + '.' : '',
    tabs: tabs
  };
  Logger.log(JSON.stringify(res));
  return res;
}

function cajaMigrateSheets_(p, user) {
  if (!cajaIsAdmin_(user)) return { ok: false, error: 'Solo admin puede migrar Caja_*' };
  p = p || {};
  var force = p.force === true || p.force === 1 || p.force === '1' || String(p.force || '').toLowerCase() === 'true';
  var liveOnly = p.liveOnly === true || p.liveOnly === 1 || p.liveOnly === '1' || String(p.liveOnly || '').toLowerCase() === 'true';
  var destSs = cajaDestSs_();
  var opened;
  try {
    opened = cajaOpenSourceSs_({ liveOnly: liveOnly });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
  var srcSs = opened.ss;
  var srcSheets = srcSs.getSheets();
  var copied = [];
  var skipped = [];
  var createdEmpty = [];
  var sourceTabs = [];
  var filled = {};
  srcSheets.forEach(function (sh) {
    var name = String(sh.getName() || '').trim();
    if (!name) return;
    var lastCol = sh.getLastColumn();
    sourceTabs.push({
      name: name,
      rows: Math.max(0, sh.getLastRow() - 1),
      headers: lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || ''); }) : []
    });
    if (cajaSkipSourceTab_(name)) {
      skipped.push({ source: name, reason: 'PIN/Usuarios omitido — Admin Usuarios (EFCH/Osvaldo/Secre) es la fuente de verdad' });
      return;
    }
    if (!CAJA_DEST_MAP[name]) {
      skipped.push({ source: name, reason: 'fuera de Caja/Rutas (solo Rutas, Gastos, Entregas, Config, Cortes)' });
      return;
    }
    var destName = cajaDestName_(name);
    if (filled[destName]) {
      skipped.push({ source: name, dest: destName, reason: 'ya copiada en esta corrida' });
      return;
    }
    var dest = destSs.getSheetByName(destName);
    var vals = sh.getDataRange().getValues();
    var srcRows = vals && vals.length ? vals.length : 0;
    if (!dest) {
      dest = destSs.insertSheet(destName);
      if (srcRows) dest.getRange(1, 1, srcRows, vals[0].length).setValues(vals);
      if (srcRows >= 2) filled[destName] = 1;
      copied.push(destName);
      return;
    }
    var existing = dest.getLastRow();
    if (existing > 1 && !force) {
      skipped.push({ dest: destName, reason: 'ya tiene datos (' + existing + ' filas). Usá migrateCajaSheetsForceFromLive para pisar con el vivo.' });
      return;
    }
    if (existing > 1 && force && srcRows < 2) {
      skipped.push({ dest: destName, reason: 'force pero el origen está vacío — no se pisa' });
      return;
    }
    dest.clearContents();
    if (srcRows) dest.getRange(1, 1, srcRows, vals[0].length).setValues(vals);
    if (srcRows >= 2) filled[destName] = 1;
    copied.push(destName + (existing > 1 ? ' (force)' : ' (estaba vacía)'));
  });
  Object.keys(CAJA_HEADERS).forEach(function (key) {
    var destName = 'Caja_' + key;
    if (!destSs.getSheetByName(destName)) {
      var sh = destSs.insertSheet(destName);
      sh.getRange(1, 1, 1, CAJA_HEADERS[key].length).setValues([CAJA_HEADERS[key]]);
      if (key === 'Config') {
        sh.getRange(2, 1, CAJA_CONFIG_SEED.length, CAJA_CONFIG_SEED[0].length).setValues(CAJA_CONFIG_SEED);
      }
      createdEmpty.push(destName);
    }
  });
  SpreadsheetApp.flush();
  return {
    ok: true,
    action: liveOnly && force ? 'migrateCajaSheetsForceFromLive' : 'migrateCajaSheets',
    version: CAJA_API_VERSION,
    force: force,
    liveOnly: liveOnly,
    sourceId: opened.id,
    sourceTitle: opened.title,
    preferredLiveId: CAJA_SOURCE_LIVE_ID,
    usedFallback: opened.usedFallback,
    staleCopy: !!opened.staleCopy,
    warning: opened.staleCopy ? 'Se usó la copia del 19-sep. Corré migrateCajaSheetsForceFromLive para traer el Minecore App vivo.' : '',
    sourceTabs: sourceTabs,
    copied: copied,
    skipped: skipped,
    createdEmpty: createdEmpty,
    destId: destSs.getId()
  };
}

/* ===================== READ ===================== */

function cajaGetRutas_(p, user) {
  var rows = cajaRows_('Rutas');
  var rol = String(p.rol || (cajaIsAdmin_(user) ? 'admin' : 'chofer'));
  var usuario = String(p.usuario || user.usuario || '');
  var estado = String(p.estado || '');
  if (rol !== 'admin') {
    rows = rows.filter(function (r) { return String(r['Usuario'] || '') === usuario; });
  }
  if (estado) rows = rows.filter(function (r) { return String(r['Estado'] || '') === estado; });
  rows.sort(cajaSortIdDesc_);
  return { ok: true, rutas: rows };
}

function cajaGetGastos_(p, user) {
  var rows = cajaRows_('Gastos');
  var rol = String(p.rol || (cajaIsAdmin_(user) ? 'admin' : 'chofer'));
  var usuario = String(p.usuario || user.usuario || '');
  var estado = String(p.estado || '');
  if (rol !== 'admin') {
    rows = rows.filter(function (r) { return String(r['Usuario'] || '') === usuario; });
  }
  if (estado) rows = rows.filter(function (r) { return String(r['Estado'] || '') === estado; });
  rows.sort(cajaSortIdDesc_);
  return { ok: true, gastos: rows };
}

function cajaGetEntregas_(p, user) {
  var rows = cajaRows_('Entregas');
  var rol = String(p.rol || (cajaIsAdmin_(user) ? 'admin' : 'chofer'));
  var usuario = String(p.usuario || user.usuario || '');
  if (rol !== 'admin') {
    rows = rows.filter(function (r) {
      return String(r['Usuario Destino'] || '') === usuario || String(r['Admin'] || '') === usuario;
    });
  }
  rows.sort(cajaSortIdDesc_);
  return { ok: true, entregas: rows };
}

function cajaGetBalance_(p, user) {
  var entregas = cajaRows_('Entregas');
  var gastos = cajaRows_('Gastos');
  var map = {};
  function bump(u, nombre) {
    u = String(u || '').trim();
    if (!u) return null;
    if (!map[u]) {
      map[u] = {
        usuario: u,
        nombre: nombre || CAJA_NAME_HINTS[u] || u,
        entregado: 0,
        aprobado: 0,
        pendiente: 0,
        disponible: 0
      };
    }
    return map[u];
  }
  entregas.forEach(function (e) {
    var b = bump(e['Usuario Destino'], '');
    if (b) b.entregado += cajaNum_(e['Monto ($)']);
  });
  gastos.forEach(function (g) {
    var b = bump(g['Usuario'], '');
    if (!b) return;
    var est = String(g['Estado'] || '');
    var m = cajaNum_(g['Monto ($)']);
    if (est === 'Aprobado') b.aprobado += m;
    else if (est === 'Pendiente') b.pendiente += m;
  });
  var balances = Object.keys(map).map(function (k) {
    var b = map[k];
    b.entregado = cajaRound2_(b.entregado);
    b.aprobado = cajaRound2_(b.aprobado);
    b.pendiente = cajaRound2_(b.pendiente);
    b.disponible = cajaRound2_(b.entregado - b.aprobado);
    if (!b.nombre || b.nombre === b.usuario) b.nombre = CAJA_NAME_HINTS[b.usuario] || b.usuario;
    return b;
  });
  return { ok: true, balances: balances };
}

function cajaGetConfig_(p, user) {
  var sh = cajaSheet_('Config');
  var vals = sh.getDataRange().getValues();
  var cfg = { precio_km: '0.40', corte_dia_inicio: '26', corte_dia_fin: '25' };
  var headers = (vals[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
  var iClave = headers.indexOf('clave');
  var iValor = headers.indexOf('valor');
  if (iClave < 0) iClave = 0;
  if (iValor < 0) iValor = 1;
  for (var i = 1; i < vals.length; i++) {
    var k = String(vals[i][iClave] || '').trim();
    if (!k) continue;
    cfg[k] = String(vals[i][iValor] == null ? '' : vals[i][iValor]);
  }
  return { ok: true, config: cfg };
}

/* ===================== WRITE ===================== */

function cajaUpdateConfig_(p, user) {
  if (!cajaIsAdmin_(user) && !cajaHasPlus_(user)) return { ok: false, error: 'Sin permiso para config' };
  var clave = String(p.clave || '').trim();
  if (!clave) return { ok: false, error: 'clave requerida' };
  var valor = String(p.valor == null ? '' : p.valor);
  var sh = cajaSheet_('Config');
  var vals = sh.getDataRange().getValues();
  var headers = (vals[0] || []).map(function (h) { return String(h || '').trim(); });
  var iClave = -1, iValor = -1;
  for (var h = 0; h < headers.length; h++) {
    var hn = headers[h].toLowerCase();
    if (hn === 'clave' && iClave < 0) iClave = h;
    if (hn === 'valor' && iValor < 0) iValor = h;
  }
  if (iClave < 0) iClave = 0;
  if (iValor < 0) iValor = 1;
  var found = false;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iClave] || '').trim() === clave) {
      sh.getRange(i + 1, iValor + 1).setValue(valor);
      found = true;
      break;
    }
  }
  if (!found) {
    var row = headers.length ? headers.map(function () { return ''; }) : ['', '', ''];
    row[iClave] = clave;
    row[iValor] = valor;
    sh.appendRow(row);
  }
  return { ok: true };
}

function cajaCrearRuta_(p, user) {
  var who = String(p.usuario || cajaWho_(user, p) || '').trim();
  if (!who) return { ok: false, error: 'usuario requerido' };
  var km = cajaNum_(p.km);
  if (!(km > 0)) return { ok: false, error: 'km inválido' };
  return cajaIdemCreate_('Rutas', p, [who, km, p.origen || '', p.destino || '', cajaYmd_(p.fechaServicio) || '', p.tipo || '', p.motivo || '', p.vehiculo || ''], function () {
    return cajaCrearRutaCore_(p, user, who, km);
  });
}

function cajaCrearRutaCore_(p, user, who, km) {
  var cfg = cajaGetConfig_(p, user).config || {};
  var rate = cajaNum_(p.precioKm != null ? p.precioKm : cfg.precio_km);
  if (!(rate > 0)) rate = 0.40;
  var valor = cajaRound2_(km * rate);
  var fechaServ = cajaYmd_(p.fechaServicio) || cajaYmd_(new Date());
  var id = 'R-' + Date.now();
  var row = {
    'ID': id,
    'Fecha Solicitud': cajaNow_(),
    'Fecha Servicio': fechaServ,
    'Usuario': who,
    'Origen': p.origen || '',
    'Destino': p.destino || '',
    'KM': km,
    'Tipo': p.tipo || 'Entrega',
    'Motivo': p.motivo || 'Sin descripción',
    'Estado': 'Pendiente',
    'Valor ($)': valor,
    'Fecha Aprobacion': '',
    'Aprobado Por': '',
    'Notas': '',
    'Periodo': cajaPeriodoLabel_(fechaServ, cfg),
    'Vehiculo': p.vehiculo || ''
  };
  cajaAppend_('Rutas', row);
  return { ok: true, id: id };
}

function cajaEditarRuta_(p, user) {
  var hit = cajaFindById_('Rutas', p.id);
  if (!hit) return { ok: false, error: 'Ruta no encontrada' };
  var patch = {};
  if (p.estado) patch['Estado'] = p.estado;
  if (p.vehiculo != null) patch['Vehiculo'] = p.vehiculo;
  if (p.km != null) patch['KM'] = cajaNum_(p.km);
  if (p.valor != null) patch['Valor ($)'] = cajaNum_(p.valor);
  if (p.origen != null) patch['Origen'] = p.origen;
  if (p.destino != null) patch['Destino'] = p.destino;
  if (p.estado === 'Aprobada') {
    patch['Aprobado Por'] = cajaWho_(user, p);
    patch['Fecha Aprobacion'] = new Date().toISOString();
  }
  cajaPatchRow_('Rutas', hit.row, patch);
  return { ok: true };
}

function cajaAprobarRuta_(p, user) {
  var hit = cajaFindById_('Rutas', p.id);
  if (!hit) return { ok: false, error: 'Ruta no encontrada' };
  cajaPatchRow_('Rutas', hit.row, {
    'Estado': 'Aprobada',
    'Aprobado Por': cajaWho_(user, p),
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaRechazarRuta_(p, user) {
  var hit = cajaFindById_('Rutas', p.id);
  if (!hit) return { ok: false, error: 'Ruta no encontrada' };
  cajaPatchRow_('Rutas', hit.row, {
    'Estado': 'Rechazada',
    'Aprobado Por': cajaWho_(user, p),
    'Fecha Aprobacion': new Date().toISOString(),
    'Notas': p.notas || ''
  });
  return { ok: true };
}

function cajaCrearGasto_(p, user) {
  var who = String(p.usuario || cajaWho_(user, p) || '').trim();
  var monto = cajaNum_(p.monto);
  if (!(monto > 0)) return { ok: false, error: 'monto inválido' };
  return cajaIdemCreate_('Gastos', p, [who, monto, p.categoria || '', p.descripcion || '', p.fotoUrl || ''], function () {
    return cajaCrearGastoCore_(p, user, who, monto);
  });
}

function cajaCrearGastoCore_(p, user, who, monto) {
  var id = 'G-' + Date.now();
  var cfg = cajaGetConfig_(p, user).config || {};
  var row = {
    'ID': id,
    'Fecha': new Date(),
    'Usuario': who,
    'Monto ($)': monto,
    'Categoria': p.categoria || 'Otros',
    'Descripcion': p.descripcion || 'Sin descripción',
    'Foto URL': p.fotoUrl || '',
    'Estado': 'Pendiente',
    'Aprobado Por': '',
    'Fecha Aprobacion': '',
    'Periodo': cajaPeriodoLabel_(cajaYmd_(new Date()), cfg)
  };
  cajaAppend_('Gastos', row, { 'Fecha': CAJA_DATE_FMT });
  return { ok: true, id: id };
}

function cajaAprobarGasto_(p, user) {
  var hit = cajaFindById_('Gastos', p.id);
  if (!hit) return { ok: false, error: 'Gasto no encontrado' };
  cajaPatchRow_('Gastos', hit.row, {
    'Estado': 'Aprobado',
    'Aprobado Por': cajaWho_(user, p),
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaRechazarGasto_(p, user) {
  var hit = cajaFindById_('Gastos', p.id);
  if (!hit) return { ok: false, error: 'Gasto no encontrado' };
  cajaPatchRow_('Gastos', hit.row, {
    'Estado': 'Rechazado',
    'Aprobado Por': cajaWho_(user, p),
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaCrearEntrega_(p, user) {
  var dest = String(p.usuarioDestino || '').trim();
  var monto = cajaNum_(p.monto);
  if (!dest) return { ok: false, error: 'usuarioDestino requerido' };
  if (!(monto > 0)) return { ok: false, error: 'monto inválido' };
  return cajaIdemCreate_('Entregas', p, [cajaWho_(user, p), dest, monto, p.forma || '', p.descripcion || '', p.fotoUrl || ''], function () {
    return cajaCrearEntregaCore_(p, user, dest, monto);
  });
}

function cajaCrearEntregaCore_(p, user, dest, monto) {
  var id = 'E-' + Date.now();
  var cfg = cajaGetConfig_(p, user).config || {};
  var row = {
    'ID': id,
    'Fecha': new Date(),
    'Admin': cajaWho_(user, p),
    'Usuario Destino': dest,
    'Monto ($)': monto,
    'Forma': p.forma || 'Transferencia',
    'Descripcion': p.descripcion || 'Sin descripción',
    'Foto URL': p.fotoUrl || '',
    'Periodo': cajaPeriodoLabel_(cajaYmd_(new Date()), cfg)
  };
  cajaAppend_('Entregas', row, { 'Fecha': CAJA_DATE_FMT });
  return { ok: true, id: id };
}

/**
 * Hard-delete de una línea Caja_* (NO es rechazar).
 * Solo Esteban / EFCH. Quita la fila del Sheet; el balance se recalcula solo
 * (disponible = sum(entregas) − sum(gastos Aprobado)).
 * Payload: { action:'eliminarLineaCaja'|'eliminarEntrega'|'eliminarGasto'|'eliminarRuta',
 *            id:'E-…'|'G-…'|'R-…', tipo?:'entrega'|'gasto'|'ruta' }
 * No toca Caja_Cortes ni fotos en Drive.
 */
function cajaEliminarLinea_(p, user) {
  if (!cajaIsEfch_(user)) {
    return { ok: false, error: 'Solo Esteban (EFCH) puede eliminar líneas de Caja' };
  }
  var id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id requerido' };
  var tipo = String(p.tipo || p.kind || p.sheet || '').toLowerCase().trim();
  if (!tipo) {
    if (/^E-/i.test(id)) tipo = 'entrega';
    else if (/^G-/i.test(id)) tipo = 'gasto';
    else if (/^R-/i.test(id)) tipo = 'ruta';
  }
  var kindMap = {
    entrega: 'Entregas', entregas: 'Entregas', e: 'Entregas',
    gasto: 'Gastos', gastos: 'Gastos', g: 'Gastos',
    ruta: 'Rutas', rutas: 'Rutas', r: 'Rutas'
  };
  var kind = kindMap[tipo];
  if (!kind) return { ok: false, error: 'tipo inválido (entrega|gasto|ruta)' };
  var hit = cajaFindById_(kind, id);
  if (!hit) return { ok: false, error: kind.slice(0, -1) + ' no encontrada' };
  var snapshot = {};
  for (var i = 0; i < hit.headers.length; i++) {
    if (hit.headers[i]) snapshot[hit.headers[i]] = cajaCell_(hit.values[i]);
  }
  cajaDeleteRow_(kind, hit.row);
  return {
    ok: true,
    deleted: true,
    tipo: kind.toLowerCase(),
    id: id,
    row: snapshot
  };
}

function cajaCerrarCorte_(p, user) {
  var periodo = String(p.periodo || '').trim();
  if (!periodo) return { ok: false, error: 'periodo requerido' };
  var sh = cajaSheet_('Cortes');
  var vals = sh.getDataRange().getValues();
  var headers = (vals[0] || []).map(function (h) { return String(h || '').trim(); });
  var iPeriodo = headers.indexOf('Periodo');
  if (iPeriodo < 0) iPeriodo = headers.length ? 1 : 0;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iPeriodo] || '') === periodo) {
      return { ok: true, already: true };
    }
  }
  var rutas = cajaRows_('Rutas').filter(function (r) { return r['Estado'] === 'Aprobada'; });
  var inPeriod = rutas.filter(function (r) { return String(r['Periodo'] || '') === periodo; });
  if (inPeriod.length) rutas = inPeriod;
  var km = 0, usd = 0;
  rutas.forEach(function (r) { km += cajaNum_(r['KM']); usd += cajaNum_(r['Valor ($)']); });
  var id = 'CORTE-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyyMMdd-HHmmss');
  cajaAppend_('Cortes', {
    'ID': id,
    'Periodo': periodo,
    'Fecha': cajaNow_(),
    'Total KM': cajaRound2_(km),
    'Total USD': cajaRound2_(usd),
    'Rutas': rutas.length,
    'Admin': cajaWho_(user, p),
    'Estado': 'Cerrado'
  });
  return { ok: true, id: id };
}

function cajaSavePhoto_(p, user) {
  var b64 = String(p.base64 || '');
  if (!b64) return { ok: false, error: 'base64 vacío' };
  if (b64.indexOf(',') >= 0) b64 = b64.split(',').pop();
  var bytes = Utilities.base64Decode(b64);
  var mime = p.mimeType || 'image/jpeg';
  var nombre = String(p.nombre || 'foto.jpg').replace(/[\\\/]/g, '_');
  var folder = cajaPhotosFolder_();
  var blob = Utilities.newBlob(bytes, mime, nombre);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: file.getUrl(), id: file.getId() };
}

/* ===================== AUTH / PERMS ===================== */

function cajaAuth_(p) {
  if (typeof authUser_ === 'function') return authUser_(p);
  if (typeof requireUser_ === 'function') return requireUser_(p);
  if (typeof getUser_ === 'function') return getUser_(p.user, p.pin);
  return cajaAuthFromSheet_(p);
}

function cajaAuthFromSheet_(p) {
  var userName = String(p.user || p.usuario || '').trim();
  var pin = String(p.pin || p.userPin || '');
  if (!userName || !pin) return null;
  var ss = cajaDestSs_();
  var sh = ss.getSheetByName('Usuarios') || ss.getSheetByName('Admin_Usuarios') || ss.getSheetByName('Users');
  if (!sh) return null;
  var vals = sh.getDataRange().getValues();
  if (!vals.length) return null;
  var headers = vals[0].map(function (h) { return String(h || '').toLowerCase().trim(); });
  function col(cands) {
    for (var i = 0; i < cands.length; i++) {
      var ix = headers.indexOf(cands[i]);
      if (ix >= 0) return ix;
    }
    return -1;
  }
  var iNom = col(['nombre', 'usuario', 'user', 'nombre/iniciales']);
  var iPin = col(['pin', 'userpin', 'clave']);
  var iRol = col(['rol', 'role']);
  var iMod = col(['modulos', 'módulos', 'modulosdisponibles']);
  var iAct = col(['activo', 'active']);
  if (iNom < 0 || iPin < 0) return null;
  for (var r = 1; r < vals.length; r++) {
    var nom = String(vals[r][iNom] || '').trim();
    if (nom.toLowerCase() !== userName.toLowerCase()) continue;
    if (String(vals[r][iPin] || '') !== pin) return null;
    if (iAct >= 0 && /^(no|0|false|off)$/i.test(String(vals[r][iAct] || 'SI'))) return null;
    var mods = iMod >= 0 ? String(vals[r][iMod] || '') : '';
    return {
      usuario: nom,
      nombre: nom,
      rol: iRol >= 0 ? String(vals[r][iRol] || 'usuario') : 'usuario',
      modulos: mods.split(',').map(function (x) { return x.trim(); }).filter(String)
    };
  }
  return null;
}

function cajaAllowedSession_(user) {
  var parts = [user && user.usuario, user && user.nombre];
  for (var i = 0; i < parts.length; i++) {
    var raw = String(parts[i] || '').trim();
    if (!raw) continue;
    var key = raw.toLowerCase();
    try { key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e2) {}
    if (CAJA_SESSION_ALLOW[key]) return true;
    var first = key.split(/\s+/)[0];
    if (CAJA_SESSION_ALLOW[first]) return true;
  }
  return false;
}
function cajaIsAdmin_(user) {
  return String(user && user.rol || '').toLowerCase() === 'admin';
}
/** Solo Esteban (EFCH). Osvaldo/Secre pueden ser rol admin pero NO pueden hard-delete. */
function cajaIsEfch_(user) {
  var parts = [user && user.usuario, user && user.nombre];
  for (var i = 0; i < parts.length; i++) {
    var raw = String(parts[i] || '').trim();
    if (!raw) continue;
    var key = raw.toLowerCase();
    try { key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e2) {}
    if (key === 'efch') return true;
    if (key.indexOf('esteban') === 0) return true;
    var first = key.split(/\s+/)[0];
    if (first === 'efch' || first === 'esteban') return true;
  }
  return false;
}
function cajaHasPlus_(user) {
  var ms = user && user.modulos;
  if (!ms) return false;
  if (typeof ms === 'string') ms = ms.split(',');
  return ms.indexOf('caja+') >= 0;
}
function cajaCanView_(user) {
  if (cajaIsAdmin_(user)) return true;
  var ms = user && user.modulos;
  if (!ms) return false;
  if (typeof ms === 'string') ms = ms.split(',');
  return ms.indexOf('caja') >= 0 || ms.indexOf('caja+') >= 0;
}
function cajaCanWrite_(user, action) {
  if (action === 'eliminarLineaCaja' || action === 'eliminarEntrega' ||
      action === 'eliminarGasto' || action === 'eliminarRuta') {
    return cajaIsEfch_(user);
  }
  if (cajaIsAdmin_(user)) return true;
  if (action === 'migrateCajaSheets') return false;
  if (action === 'updateConfig' || action === 'aprobarRuta' || action === 'rechazarRuta' ||
      action === 'aprobarGasto' || action === 'rechazarGasto' || action === 'crearEntrega' ||
      action === 'cerrarCorte' || action === 'editarRuta') {
    return cajaHasPlus_(user) && cajaIsAdmin_(user);
  }
  return cajaHasPlus_(user);
}

/* ===================== SHEETS HELPERS ===================== */

function cajaDestSs_() {
  var id = CAJA_ADMIN_DB_FALLBACK;
  try {
    if (typeof getProps_ === 'function') {
      var pr = getProps_();
      if (pr && pr.sheetId) id = pr.sheetId;
    }
  } catch (e) {}
  return SpreadsheetApp.openById(id);
}

function cajaSkipSourceTab_(name) {
  var n = String(name || '').trim().toUpperCase().replace(/\s+/g, '');
  if (CAJA_SKIP_SOURCE_TABS[n]) return true;
  if (n.indexOf('USUARIO') >= 0 || n.indexOf('PIN') >= 0) return true;
  return false;
}

function cajaDestName_(sourceName) {
  var n = String(sourceName || '').trim();
  if (CAJA_DEST_MAP[n]) return CAJA_DEST_MAP[n];
  if (/^Caja_/i.test(n)) return n;
  if (/^Caja/i.test(n)) return 'Caja_' + n.replace(/^Caja/i, '');
  return 'Caja_' + n.replace(/\s+/g, '_');
}

function cajaSheet_(kind) {
  var ss = cajaDestSs_();
  var aliases = CAJA_SHEET_ALIASES[kind] || ['Caja_' + kind];
  var sh = null;
  for (var i = 0; i < aliases.length; i++) {
    sh = ss.getSheetByName(aliases[i]);
    if (sh) return sh;
  }
  var name = aliases[0];
  sh = ss.insertSheet(name);
  var hdrs = CAJA_HEADERS[kind] || ['ID'];
  sh.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
  if (kind === 'Config') {
    sh.getRange(2, 1, CAJA_CONFIG_SEED.length, CAJA_CONFIG_SEED[0].length).setValues(CAJA_CONFIG_SEED);
  }
  return sh;
}

function cajaRows_(kind) {
  var sh = cajaSheet_(kind);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0].map(function (h) { return String(h || '').trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    if (!String(vals[i][0] || '') && !String(vals[i][1] || '')) continue;
    var o = {};
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      o[headers[c]] = cajaCell_(vals[i][c]);
    }
    out.push(o);
  }
  return out;
}

function cajaCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CAJA_TZ, 'yyyy-MM-dd HH:mm:ss');
  return v;
}

function cajaFindById_(kind, id) {
  id = String(id || '');
  if (!id) return null;
  var sh = cajaSheet_(kind);
  var vals = sh.getDataRange().getValues();
  var headers = vals[0].map(function (h) { return String(h || '').trim(); });
  var iId = headers.indexOf('ID');
  if (iId < 0) iId = 0;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId] || '') === id) return { row: r + 1, headers: headers, values: vals[r] };
  }
  return null;
}

function cajaAppend_(kind, obj, formats) {
  var sh = cajaSheet_(kind);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var row = headers.map(function (h) { return obj[h] != null ? obj[h] : ''; });
  sh.appendRow(row);
  if (formats) {
    var r = sh.getLastRow();
    Object.keys(formats).forEach(function (h) {
      var ix = headers.indexOf(h);
      if (ix >= 0) { try { sh.getRange(r, ix + 1).setNumberFormat(formats[h]); } catch (e) {} }
    });
  }
  return sh.getLastRow();
}

/**
 * v129 — alta idempotente para Caja_*.
 * 1) LockService (script lock) serializa altas concurrentes (doble clic / reintento en paralelo).
 * 2) clientReqId (lo genera el portal al abrir el formulario y lo reutiliza en cada reintento):
 *    si ya se procesó, devuelve el mismo ID sin insertar (CacheService, 6 h).
 * 3) Huella de contenido: misma línea (sin clientReqId o con uno distinto) en < 2 min ⇒ no inserta.
 */
function cajaIdemCreate_(kind, p, fingerprintParts, createFn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'Servidor ocupado, reintentá en unos segundos (no se guardó)' };
  try {
    var cache = CacheService.getScriptCache();
    var reqId = String(p.clientReqId || '').trim().slice(0, 120);
    var kReq = reqId ? 'cajaReq:' + kind + ':' + reqId : '';
    var kFp = 'cajaFp:' + kind + ':' + cajaHash_(fingerprintParts.map(function (x) {
      return (typeof x === 'number') ? String(cajaRound2_(x)) : String(x == null ? '' : x).trim().toLowerCase();
    }).join('|'));
    if (kReq) {
      var prevId = cache.get(kReq);
      if (prevId) return { ok: true, id: prevId, dedup: 'clientReqId' };
    }
    var fpId = cache.get(kFp);
    if (fpId) {
      if (kReq) cache.put(kReq, fpId, 21600);
      return { ok: true, id: fpId, dedup: 'contenido' };
    }
    var out = createFn();
    if (out && out.ok && out.id) {
      SpreadsheetApp.flush();
      if (kReq) cache.put(kReq, String(out.id), 21600);
      cache.put(kFp, String(out.id), CAJA_DUP_WINDOW_S);
    }
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** v129: quién hace la acción. El motor puede devolver la sesión como usuario/user/nombre;
 *  en v128 la columna Admin de Caja_Entregas quedaba vacía. */
function cajaWho_(user, p) {
  user = user || {}; p = p || {};
  var v = user.usuario || user.user || user.iniciales || user.nombre || user.name || p.admin || p.user || '';
  v = String(v || '').trim();
  var k = v.toLowerCase();
  if (k === 'esteban' || k.indexOf('esteban') === 0 || k === 'efch') return 'EFCH';
  if (k === 'osvaldo' || k === 'oswaldo' || k.indexOf('oswaldo pe') === 0 || k.indexOf('osvaldo pe') === 0 || k === 'opm') return 'OPM';
  return v;
}

function cajaHash_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8);
  return raw.map(function (b) { var h = (b & 0xff).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

function cajaPatchRow_(kind, rowNum, patch) {
  var sh = cajaSheet_(kind);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  Object.keys(patch).forEach(function (k) {
    var ix = headers.indexOf(k);
    if (ix >= 0) sh.getRange(rowNum, ix + 1).setValue(patch[k]);
  });
}

function cajaDeleteRow_(kind, rowNum) {
  var sh = cajaSheet_(kind);
  sh.deleteRow(rowNum);
}

function cajaPhotosFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CAJA_PHOTOS_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName('Minecore Caja Fotos');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Minecore Caja Fotos');
  props.setProperty('CAJA_PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

function cajaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function cajaNum_(v) { return parseFloat(v) || 0; }
function cajaRound2_(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }
function cajaNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyy-MM-dd HH:mm:ss');
}
function cajaYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyy-MM-dd');
  var s = String(v).split('T')[0].split(' ')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function cajaPeriodoLabel_(ymd, cfg) {
  var ini = parseInt(cfg && cfg.corte_dia_inicio || 26, 10) || 26;
  var d = ymd ? new Date(ymd + 'T12:00:00') : new Date();
  var day = d.getDate();
  var fi, ff;
  if (day >= ini) {
    fi = new Date(d.getFullYear(), d.getMonth(), ini);
    ff = new Date(d.getFullYear(), d.getMonth() + 1, ini - 1);
  } else {
    fi = new Date(d.getFullYear(), d.getMonth() - 1, ini);
    ff = new Date(d.getFullYear(), d.getMonth(), ini - 1);
  }
  var M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return ini + '-' + M[fi.getMonth()] + '-' + fi.getFullYear() + ' / ' + (ini - 1) + '-' + M[ff.getMonth()] + '-' + ff.getFullYear();
}
function cajaSortIdDesc_(a, b) {
  return String(b['ID'] || '').localeCompare(String(a['ID'] || ''));
}

/**
 * El motor en producción ya tiene doGet/doPost. No dupliques esos nombres.
 * En el doGet del motor devolvés version v129 y cajaNative true (ver PASTE_v129.md).
 * cajaDispatch_ se llama desde doPost después de autenticar.
 */
function cajaDoGetHint_() {
  return { ok: true, service: 'Minecore Admin API', version: CAJA_API_VERSION, cajaNative: true, cajaIdem: true };
}
