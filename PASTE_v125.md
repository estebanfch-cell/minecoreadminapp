# PASTE AdminAPI v125 — Caja nativa (EFCH)

El frontend nativo ya no usa iframe a `estebanfch-cell.github.io/minecore`.  
Las acciones de Caja viven en el **mismo AdminAPI**, con la **sesión Admin** (EFCH / Osvaldo / Secre). No hay segundo login ni PIN de Caja.

## Spreadsheets (IDs exactos)

| Rol | Título | ID |
|---|---|---|
| Caja source | Minecore App | `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY` |
| Admin DB | Minecore - Datos inFlow | `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` |

**IDs verificados (usar solo estos):**

- Caja source `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY` — Minecore App. Tabs: `Usuarios` (no copiar), `Rutas`, `Gastos`, `Entregas`, `Config` (+ `Cortes` si está).
- Admin DB `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` — Minecore - Datos inFlow. Aún sin `Caja_*`.

Columnas operativas (API live + headers de esas tabs):

| Tab | Columnas |
|---|---|
| `Rutas` | ID, Fecha Solicitud, Fecha Servicio, Usuario, Origen, Destino, KM, Tipo, Motivo, Estado, Valor ($), Fecha Aprobacion, Aprobado Por, Notas, Periodo, Vehiculo |
| `Gastos` | ID, Fecha, Usuario, Monto ($), Categoria, Descripcion, Foto URL, Estado, Aprobado Por, Fecha Aprobacion, Periodo |
| `Entregas` | ID, Fecha, Admin, Usuario Destino, Monto ($), Forma, Descripcion, Foto URL, Periodo |
| `Config` | Clave, Valor, Descripcion — `precio_km` / `corte_dia_inicio` / `corte_dia_fin` |
| `Cortes` (si existe) | ID, Periodo, Fecha, Total KM, Total USD, Rutas, Admin, Estado |

En el editor, `inspectCajaSource()` vuelca nombre + headers reales de Minecore App.

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

- Abre **solo** Minecore App `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY`.
- Copia pestañas operativas al Admin DB `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` (`getProps_().sheetId`):

  | Source (Minecore App) | Destino Admin DB |
  |---|---|
  | `Rutas` | `Caja_Rutas` |
  | `Gastos` (alias `CajaGastos`) | `Caja_Gastos` |
  | `Entregas` (alias `CajaEntregas`) | `Caja_Entregas` |
  | `Config` | `Caja_Config` |
  | `Cortes` | `Caja_Cortes` |

- **No copia** la pestaña `Usuarios` (PIN de Caja). Sesión = EFCH / Osvaldo / Secre en Admin → Usuarios. Sin PIN de Caja.
- Si `Caja_*` ya tiene filas, no las pisa.

También se puede disparar desde Admin (solo rol admin) con `{action:'migrateCajaSheets', user, pin}`.

## 3. Google Maps (Places + Geometry)

La UI nativa carga la misma key de minecore:

`AIzaSyAZR0KRqBE382md01vyeKMbW53_g7fHb2o`

En Google Cloud → Credentials → esa key → **Website restrictions**, agregá (si no está):

- `https://portal.minecore.ec/*`
- `https://estebanfch-cell.github.io/*`

Sin eso el mapa de Nueva ruta falla en el portal (Places/Geometry).

## 4. Hard-refresh del portal

1. Espera a que GitHub Pages publique este `index` (v195+).
2. Abre `https://portal.minecore.ec/?v=195` (o el build del footer).
3. Hard-refresh / borra el bookmark viejo si sale el banner de versión.

En el home, Motor API debe decir **`v125 ✓`**.

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
