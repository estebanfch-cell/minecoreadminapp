/**
 * AdminAPI_v125.gs — Caja Chica + Rutas nativo (Minecore Admin)
 * Version string: v125
 *
 * NO reemplaza el motor Admin existente. Pégalo como ARCHIVO NUEVO
 * en el proyecto de Apps Script del AdminAPI (el de portal.minecore.ec)
 * y aplica el cableado de PASTE_v125.md.
 *
 * Acciones nativas (mismos JSON que el Caja API viejo):
 *   getRutas, getGastos, getEntregas, getBalanceCaja, getConfig, updateConfig,
 *   crearRuta, editarRuta, aprobarRuta, rechazarRuta,
 *   crearGasto, aprobarGasto, rechazarGasto, crearEntrega,
 *   cerrarCorte, savePhoto, migrateCajaSheets
 *
 * Omitidas a propósito (EFCH lock): login, crearUsuario, editarUsuario, eliminarUsuario.
 *
 * Auth: sesión Admin únicamente (EFCH / Osvaldo / Secre). Sin PIN de Caja
 * y sin CRUD de usuarios Caja. Los movimientos se atribuyen a
 * user.usuario / user.nombre de esa sesión.
 *
 * Spreadsheets (IDs exactos, únicos):
 *   Caja source (Minecore App): 1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY
 *   Admin DB (Minecore - Datos inFlow): 1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY
 *
 * Tabs source (EFCH): Usuarios (omitida), Rutas, Gastos, Entregas, Config
 * + Cortes si existe. Alias CajaGastos / CajaEntregas por si el libro las usa.
 * Columnas confirmadas vía API live getRutas / getGastos / getEntregas / getConfig.
 */

var CAJA_API_VERSION = 'v125';
var CAJA_SOURCE_ID = '1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY';
var CAJA_ADMIN_DB_FALLBACK = '1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY';
var CAJA_SKIP_SOURCE_TABS = { USUARIOS: 1, USERS: 1 };
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
    else if (action === 'cerrarCorte') out = cajaCerrarCorte_(p, user);
    else if (action === 'savePhoto') out = cajaSavePhoto_(p, user);
    else if (action === 'migrateCajaSheets') out = cajaMigrateSheets_(p, user);
    else return null;
    return cajaJson_(out);
  } catch (e) {
    return cajaJson_({ ok: false, error: String(e && e.message || e) });
  }
}

/** Corre desde el editor: migrateCajaSheets() — una vez, idempotente. */
function migrateCajaSheets() {
  var fakeAdmin = { usuario: 'EFCH', nombre: 'Esteban Ferlito', rol: 'admin', modulos: ['caja+'] };
  var res = cajaMigrateSheets_({}, fakeAdmin);
  Logger.log(JSON.stringify(res));
  return res;
}

function inspectCajaSource() {
  var ss = SpreadsheetApp.openById(CAJA_SOURCE_ID);
  var tabs = ss.getSheets().map(function (sh) {
    var lastCol = sh.getLastColumn();
    var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || ''); }) : [];
    return { name: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1), headers: headers };
  });
  var res = { ok: true, sourceId: CAJA_SOURCE_ID, title: ss.getName(), tabs: tabs };
  Logger.log(JSON.stringify(res));
  return res;
}

function cajaMigrateSheets_(p, user) {
  if (!cajaIsAdmin_(user)) return { ok: false, error: 'Solo admin puede migrar Caja_*' };
  var destSs = cajaDestSs_();
  var srcSs;
  try {
    srcSs = SpreadsheetApp.openById(CAJA_SOURCE_ID);
  } catch (e) {
    return {
      ok: false,
      error: 'No se pudo abrir Caja source ' + CAJA_SOURCE_ID +
        ' (' + String(e && e.message || e) +
        '). El ID es el verificado de Minecore App; la cuenta del Apps Script debe tener acceso.'
    };
  }
  var srcSheets = srcSs.getSheets();
  var copied = [];
  var skipped = [];
  var createdEmpty = [];
  var sourceTabs = [];
  srcSheets.forEach(function (sh) {
    var name = String(sh.getName() || '').trim();
    if (!name) return;
    var lastCol = sh.getLastColumn();
    sourceTabs.push({
      name: name,
      rows: Math.max(0, sh.getLastRow() - 1),
      headers: lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || ''); }) : []
    });
    if (CAJA_SKIP_SOURCE_TABS[name.toUpperCase()]) {
      skipped.push({ source: name, reason: 'PIN/Usuarios omitido' });
      return;
    }
    var destName = cajaDestName_(name);
    var dest = destSs.getSheetByName(destName);
    var vals = sh.getDataRange().getValues();
    if (!dest) {
      dest = destSs.insertSheet(destName);
      if (vals && vals.length) dest.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
      copied.push(destName);
      return;
    }
    var existing = dest.getLastRow();
    if (existing <= 1) {
      dest.clearContents();
      if (vals && vals.length) dest.getRange(1, 1, vals.length, vals[0].length).setValues(vals);
      copied.push(destName + ' (estaba vacía)');
    } else {
      skipped.push({ dest: destName, reason: 'ya tiene datos (' + existing + ' filas)' });
    }
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
  return {
    ok: true,
    action: 'migrateCajaSheets',
    sourceId: CAJA_SOURCE_ID,
    sourceTitle: srcSs.getName(),
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
  var who = String(p.usuario || user.usuario || '').trim();
  if (!who) return { ok: false, error: 'usuario requerido' };
  var km = cajaNum_(p.km);
  if (!(km > 0)) return { ok: false, error: 'km inválido' };
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
    patch['Aprobado Por'] = user.usuario;
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
    'Aprobado Por': user.usuario,
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaRechazarRuta_(p, user) {
  var hit = cajaFindById_('Rutas', p.id);
  if (!hit) return { ok: false, error: 'Ruta no encontrada' };
  cajaPatchRow_('Rutas', hit.row, {
    'Estado': 'Rechazada',
    'Aprobado Por': user.usuario,
    'Fecha Aprobacion': new Date().toISOString(),
    'Notas': p.notas || ''
  });
  return { ok: true };
}

function cajaCrearGasto_(p, user) {
  var who = String(p.usuario || user.usuario || '').trim();
  var monto = cajaNum_(p.monto);
  if (!(monto > 0)) return { ok: false, error: 'monto inválido' };
  var id = 'G-' + Date.now();
  var cfg = cajaGetConfig_(p, user).config || {};
  var row = {
    'ID': id,
    'Fecha': new Date().toISOString(),
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
  cajaAppend_('Gastos', row);
  return { ok: true, id: id };
}

function cajaAprobarGasto_(p, user) {
  var hit = cajaFindById_('Gastos', p.id);
  if (!hit) return { ok: false, error: 'Gasto no encontrado' };
  cajaPatchRow_('Gastos', hit.row, {
    'Estado': 'Aprobado',
    'Aprobado Por': user.usuario,
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaRechazarGasto_(p, user) {
  var hit = cajaFindById_('Gastos', p.id);
  if (!hit) return { ok: false, error: 'Gasto no encontrado' };
  cajaPatchRow_('Gastos', hit.row, {
    'Estado': 'Rechazado',
    'Aprobado Por': user.usuario,
    'Fecha Aprobacion': new Date().toISOString()
  });
  return { ok: true };
}

function cajaCrearEntrega_(p, user) {
  var dest = String(p.usuarioDestino || '').trim();
  var monto = cajaNum_(p.monto);
  if (!dest) return { ok: false, error: 'usuarioDestino requerido' };
  if (!(monto > 0)) return { ok: false, error: 'monto inválido' };
  var id = 'E-' + Date.now();
  var cfg = cajaGetConfig_(p, user).config || {};
  var row = {
    'ID': id,
    'Fecha': new Date().toISOString(),
    'Admin': user.usuario,
    'Usuario Destino': dest,
    'Monto ($)': monto,
    'Forma': p.forma || 'Transferencia',
    'Descripcion': p.descripcion || 'Sin descripción',
    'Foto URL': p.fotoUrl || '',
    'Periodo': cajaPeriodoLabel_(cajaYmd_(new Date()), cfg)
  };
  cajaAppend_('Entregas', row);
  return { ok: true, id: id };
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
    'Admin': user.usuario,
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

function cajaDestName_(sourceName) {
  var n = String(sourceName || '').trim();
  if (CAJA_DEST_MAP[n]) return CAJA_DEST_MAP[n];
  if (/^Caja_/i.test(n)) return n;
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
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyy-MM-dd HH:mm:ss');
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

function cajaAppend_(kind, obj) {
  var sh = cajaSheet_(kind);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var row = headers.map(function (h) { return obj[h] != null ? obj[h] : ''; });
  sh.appendRow(row);
}

function cajaPatchRow_(kind, rowNum, patch) {
  var sh = cajaSheet_(kind);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  Object.keys(patch).forEach(function (k) {
    var ix = headers.indexOf(k);
    if (ix >= 0) sh.getRange(rowNum, ix + 1).setValue(patch[k]);
  });
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
 * Opcional: si pegas ESTE archivo como único script de prueba, doGet/doPost
 * solo atienden Caja. En producción NO uses esto — el motor v124 ya tiene doGet/doPost.
 * El cableado correcto está en PASTE_v125.md.
 */
function cajaDoGetHint_() {
  return { ok: true, service: 'Minecore Admin API', version: CAJA_API_VERSION };
}
