# PASTE AdminAPI v125 — Caja nativa (EFCH)

El frontend nativo ya no usa iframe a `estebanfch-cell.github.io/minecore`.  
**index v196:** lecturas/escrituras de Rutas y Caja van al SCRIPT_URL que ya funciona en minecore (mismos payloads que `app.js`: GET query, `savePhoto` por POST). Sesión = Admin (EFCH / Osvaldo / Secre). No hay segundo login ni PIN de Caja.

AdminAPI v125 + `migrateCajaSheets` sigue siendo el camino a largo plazo (una sola API). Hasta que eso esté pegado y en vivo, el portal usa el backend de minecore para que historial / balance / rutas no queden vacíos.

## Spreadsheets

| Rol | Título | ID |
|---|---|---|
| Caja source **preferido** | Minecore App — Caja (copia migración Admin) | `1xHmpvXwuAvON4sw7D4ou92zszThXFHKdzUcoJ__71hA` |
| Caja source fallback | Minecore App (original) | `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY` |
| Admin DB destino | Minecore - Datos inFlow | `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` |

La copia ya está compartida **writer** con `estebanferlito@minecore.ec` (identidad del Apps Script Admin). El original puede no ser accesible para esa cuenta; `migrateCajaSheets` / `inspectCajaSource` prueban preferido y luego fallback.

Tabs de la copia (inspeccionadas):

| Source | Destino | Columnas |
|---|---|---|
| `Usuarios` | **no se copia** (PIN) | Usuario, Nombre, Rol, PIN, Activo |
| `Rutas` | `Caja_Rutas` | ID, Fecha Solicitud, Fecha Servicio, Usuario, Origen, Destino, KM, Tipo, Motivo, Estado, Valor ($), Fecha Aprobacion, Aprobado Por, Notas, Periodo, Vehiculo |
| `CajaGastos` | `Caja_Gastos` | ID, Fecha, Usuario, Monto ($), Categoria, Descripcion, Foto URL, Estado, Aprobado Por, Fecha Aprobacion, Periodo |
| `CajaEntregas` | `Caja_Entregas` | ID, Fecha, Admin, Usuario Destino, Monto ($), Forma, Descripcion, Foto URL, Periodo |
| `Config` | `Caja_Config` | Clave, Valor, Descripcion |
| `Cortes` | `Caja_Cortes` | ID, Periodo, Fecha, Total KM, Total USD, Rutas, Admin, Estado |

Admin → Usuarios (EFCH / Osvaldo / Secre) es la fuente de verdad. No hay PIN de Caja.

## 1. Apps Script (obligatorio)

1. Abre el proyecto Apps Script del **Minecore Admin API** (el de `portal.minecore.ec`, hoy v124).
2. **No borres** el archivo del motor actual.
3. Archivo → Nuevo → pega el contenido completo de `AdminAPI_v125.gs`.
4. En el `doGet` del motor, cambia la versión a **`v125`**:

```javascript
return json_({ok:true, service:'Minecore Admin API', version:'v125'});
```

(si la constante se llama `VERSION`, `API_VERSION` o similar, súbela a `'v125'`).

5. En `doPost`, **después de autenticar** al usuario Admin y **antes** del `switch`/error de acción desconocida:

```javascript
var cajaOut = cajaDispatch_(p, user);
if (cajaOut) return cajaOut;
```

`p` es el JSON parseado del POST. `user` es el objeto de sesión Admin (`usuario`/`nombre`/`rol`/`modulos`).  
Si tu helper de auth se llama distinto, `cajaDispatch_` también puede autenticar solo: `cajaDispatch_(p, null)`.

6. Implementación → Administrar implementaciones → **Nueva versión** (mismo deployment /exec).  
   El `API_URL` del `index.html` no cambia.

## 2. Migrar hojas (una vez)

En el editor de Apps Script:

1. (Opcional) Ejecuta `inspectCajaSource` y revisa `tabs` en el log.
2. Selecciona `migrateCajaSheets` y ejecuta (autoriza Drive + Sheets si pide).
3. Revisa el log: `sourceTabs` / `copied` / `skipped` / `createdEmpty`.

Qué hace (idempotente):

- Abre la copia `1xHmpvXwuAvON4sw7D4ou92zszThXFHKdzUcoJ__71hA`; si falla, el original `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY`.
- Copia pestañas operativas al Admin DB `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` (`getProps_().sheetId`) como `Caja_<Name>` (mapa de arriba).

- **No copia** la pestaña `Usuarios` (PIN de Caja). Sesión = EFCH / Osvaldo / Secre en Admin → Usuarios. Sin PIN de Caja.
- Si `Caja_*` ya tiene filas, no las pisa.

También se puede disparar desde Admin (solo rol admin) con `{action:'migrateCajaSheets', user, pin}`.

## 3. Mapa de Nueva ruta (v200 — key del portal)

El portal carga **Google Maps JS** con la key pública **Minecore Portal Maps** (GCP `casaferlito`, cuenta `estebanfch@gmail.com`):

- Key: `AIzaSyCrhdC_dRakb4Wp0lN8ySjW1ipuFuYgtD8`
- `libraries=places,geometry` + `callback=mapsReady`
- Autocomplete restringido a Ecuador (`country:'ec'`)
- Origen por defecto `MINECORE_LL` (Alpallana E7-212)
- `DirectionsService.route({provideRouteAlternatives:true})` → se elige la ruta **más corta** en km
- Tarifas: moto `$0.15` / resto `$0.40` (`VEH_RATE` / `cfg.precio_km`)

Si aparece `RefererNotAllowedMapError` / Oops, Nueva ruta muestra un aviso en español y cae a OSM **solo como respaldo silencioso**.

### Referrers HTTP (ya configurados)

Los referrers de la key del portal **ya incluyen** `https://portal.minecore.ec/*` y github.io adminapp. No hace falta agregar la key vieja de minecore (`AIzaSyAZR0…7fHb2o`). Si el Oops persiste, contactá a DevOps.

APIs habilitadas en el mismo proyecto: **Maps JavaScript API**, **Places API**, **Places API (New)**, **Directions API**, **Geocoding API**.

No hace falta tocar `estebanfch-cell/minecore`.

## 4. Hard-refresh del portal

1. Espera a que GitHub Pages publique este `index` (v200+).
2. Abre `https://portal.minecore.ec/?v=200` (o el build del footer).
3. Hard-refresh / borra el bookmark viejo si sale el banner de versión.
4. Preview del shell Caja/Rutas (sin login Admin): `preview.html` en este repo / `https://estebanfch-cell.github.io/minecoreadminapp/preview.html?v=200`.

Caja/Rutas ya leen el SCRIPT_URL de minecore (datos vivos). En el home, Motor API puede seguir en **v124** hasta que pegues v125; eso ya no vacía historial/balance.

## 5. Pruebas exactas (EFCH)

Entrar a Admin con **EFCH** (un solo login). Módulo **Rutas y Caja Chica** (`caja` / `caja+`).

### Humo (sin iframe)

1. Abre el tile. **No** debe haber iframe ni URL `github.io/minecore`.
2. Ves el dashboard nativo (Este período / Ver y gestionar / FAB).
3. Inicio → Rutas y Caja cambian de vista **dentro** del Admin (el botón ← Menú sigue volviendo al home Admin).

### Datos migrados

4. Aprobar / Historial muestran las rutas viejas (IDs `R-…`, vehículos, destinos).
5. Balance Caja muestra EFCH / OPM / etc. con los mismos entregado / gastado que el Caja viejo.
6. Historial Caja → gastos con foto abren el link de Drive.

### Escritura atribuida a la sesión Admin

7. Nueva ruta (mapa Places + Geometry, misma key de minecore) → Enviar.  
   En `Caja_Rutas` el campo **Usuario** = `EFCH` (no un PIN de Caja).
8. Registrar gasto con foto → `savePhoto` sube a Drive (`Minecore Caja Fotos`) y el gasto queda Pendiente con **Usuario = EFCH**.
9. Aprobar / rechazar ruta y gasto funciona.
10. Entregar dinero a un colaborador (OPM / Osvaldo) → fila en `Caja_Entregas` con **Admin = EFCH**.
11. Config → editar precio/km → `Caja_Config`.
12. Corte → Cerrar corte escribe en `Caja_Cortes` (segunda vez el mismo período no duplica).

### Permisos

13. Usuario con solo `caja` (Ver): ve listados, **no** crea rutas/gastos (mensaje solo lectura).
14. `caja+` (no admin): puede crear ruta/gasto; no aprueba ni entrega ni cierra corte.
15. No existe pantalla PIN de Caja ni CRUD de usuarios Caja. Solo sesión Admin **EFCH / Osvaldo / Secre**.

### Negativos

16. Osvaldo / Secre entran con **su** login Admin; los movimientos nuevos llevan **su** `usuario`/`nombre`.
17. El repo `estebanfch-cell/minecore` no se tocó.

## 6. Si Motor API no es v125

El footer del home Admin avisa en amarillo. Repite el paso 4–6 (nueva implementación) y hard-refresh.
