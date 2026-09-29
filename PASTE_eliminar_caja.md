# PASTE — Eliminar fila de Caja (no es Rechazar)

El portal **index v218** muestra **Eliminar** solo a Esteban (rol `admin`). Osvaldo y Secre no ven el botón. Rechazar sigue igual: solo cambia la columna Estado y la fila queda.

Hasta que esta acción esté en el Apps Script del Admin, el botón responde error y **no** borra nada. Pegá lo de abajo en el proyecto **Minecore inFlow Sync / AdminAPI** (el mismo donde ya está `cajaDispatch_`, v127). No hace falta cambiar `doGet` ni el `API_URL`.

Después: Implementación → **Nueva versión** del mismo `/exec`.

## Contrato

`POST` JSON (el portal ya manda `user` y `pin` de la sesión):

```json
{
  "action": "eliminarCajaFila",
  "tipo": "entrega",
  "id": "E-1710000000000",
  "user": "Esteban",
  "pin": "(el PIN de la sesión, no va en el repo)"
}
```

| `tipo` | Hoja | Efecto en disponible |
|---|---|---|
| `entrega` | `Caja_Entregas` | deja de sumar ese monto |
| `gasto` | `Caja_Gastos` | si estaba Aprobado, deja de restar |
| `ruta` | `Caja_Rutas` | sale del historial y del corte en vivo |

`id` es la columna **ID** de esa fila (una fila por llamada; si hubiera dos con el mismo ID, la segunda se borra con otro clic).

Respuesta ok:

```json
{"ok":true,"deleted":true,"tipo":"entrega","id":"E-1710000000000","sheet":"Caja_Entregas","row":12}
```

Si no es Esteban admin:

```json
{"ok":false,"error":"Solo Esteban (admin) puede eliminar filas de Caja"}
```

El disponible **no** está guardado en una celda. `getBalanceCaja` y el portal lo recalculan: entregas que quedan − gastos con Estado `Aprobado`. Un corte ya cerrado en `Caja_Cortes` no se reescribe.

## Dónde pegar

En el archivo donde vive `cajaDispatch_` (en este repo: `AdminAPI_v127.gs`). Si preferís reemplazar ese archivo entero por el del repo, ya incluye esto. Si no, estos cuatro pegados alcanzan.

### 1. Registrar la acción

Junto a `CAJA_WRITE`:

```javascript
eliminarCajaFila: 1,
```

Y el mapa (una sola vez):

```javascript
var CAJA_DELETE_KIND = {
  entrega: 'Entregas', entregas: 'Entregas',
  gasto: 'Gastos', gastos: 'Gastos',
  ruta: 'Rutas', rutas: 'Rutas'
};
```

En el `if` de acciones de `cajaDispatch_`, junto a `crearEntrega`:

```javascript
else if (action === 'eliminarCajaFila') out = cajaEliminarFila_(p, user);
```

### 2. Permiso — antes del `if (cajaIsAdmin_(user)) return true` de `cajaCanWrite_`

```javascript
if (action === 'eliminarCajaFila') return cajaCanEliminar_(user);
```

Y, en el rechazo de escritura del dispatcher, este mensaje (si no, Osvaldo vería el error genérico de caja+):

```javascript
if (action === 'eliminarCajaFila') {
  return cajaJson_({ ok: false, error: 'Solo Esteban (admin) puede eliminar filas de Caja' });
}
```

Sesión aceptada: el login `Esteban` o `EFCH`, con rol `admin`. Osvaldo / Secre no, aunque tengan `caja+` o el rol esté mal cargado como admin.

Si el allow-list de sesión todavía no tiene `esteban`, agregalo al lado de `efch` (el login del portal es el nombre Esteban, no solo las iniciales):

```javascript
esteban: 1,
```

### 3. Funciones nuevas

```javascript
function cajaSessionKey_(raw) {
  var key = String(raw || '').trim().toLowerCase();
  if (!key) return '';
  try { key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e2) {}
  return key.replace(/\s+/g, ' ');
}

function cajaCanEliminar_(user) {
  if (!cajaIsAdmin_(user)) return false;
  var parts = [user && user.usuario, user && user.nombre];
  for (var i = 0; i < parts.length; i++) {
    var key = cajaSessionKey_(parts[i]);
    if (!key) continue;
    if (key === 'esteban' || key === 'efch' || key.indexOf('esteban ') === 0) return true;
    var first = key.split(' ')[0];
    if (first === 'esteban' || first === 'efch') return true;
  }
  return false;
}

function cajaEliminarFila_(p, user) {
  if (!cajaCanEliminar_(user)) {
    return { ok: false, error: 'Solo Esteban (admin) puede eliminar filas de Caja' };
  }
  var tipo = String(p.tipo || '').toLowerCase().trim();
  var kind = CAJA_DELETE_KIND[tipo];
  if (!kind) return { ok: false, error: 'tipo inválido (entrega, gasto o ruta)' };
  var id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id requerido' };
  var gone = cajaDeleteRow_(kind, id);
  if (!gone) return { ok: false, error: 'Fila no encontrada' };
  return { ok: true, deleted: true, tipo: tipo, id: id, sheet: gone.sheet, row: gone.row };
}

function cajaDeleteRow_(kind, id) {
  var hit = cajaFindById_(kind, id);
  if (!hit) return null;
  var sh = cajaSheet_(kind);
  sh.deleteRow(hit.row);
  return { sheet: sh.getName(), row: hit.row };
}
```

`cajaDeleteRow_` va junto a `cajaPatchRow_`. Rechazar **no** llama a `deleteRow`: sigue con `cajaPatchRow_` y Estado `Rechazada` / `Rechazado`.
