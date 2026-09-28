# PASTE AdminAPI v127 — Caja nativa en la base Admin (EFCH)

El portal (index **v215**) manda **todas** las lecturas y escrituras de Rutas y Caja al `API_URL` del Admin (`MCpost`). Ya no llama al script viejo de Minecore App.

El motor en vivo hoy responde **`v124`**. Este pack sube el chip a **`v127`** (✓ cuando Caja vive en las pestañas `Caja_*` de la base Admin).

En este repo **no hay** un parche `dueDate` de v126 (ni en los PASTE ni en el script). Este archivo es **nuevo**: no reemplaza el motor. Si ya pegaste un arreglo de `dueDate` en el proyecto de Apps Script, **dejalo**. Solo subí la versión del `doGet` a `v127` y cableá `cajaDispatch_`.

## Libros

| Rol | Título | ID |
|---|---|---|
| Fuente **viva** (siempre primero) | Minecore App | `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY` |
| Copia opcional, **no preferida** (foto 19-sep, puede estar vieja) | Minecore App — copia | `1xHmpvXwuAvON4sw7D4ou92zszThXFHKdzUcoJ__71hA` |
| Destino | Minecore - Datos inFlow | `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` |

`migrateCajaSheets` abre el vivo. Solo si ese libro no abre, prueba la copia y lo avisa en el log (`staleCopy`).  
`migrateCajaSheetsForceFromLive` abre **únicamente** el vivo y pisa las pestañas destino.

| Origen | Destino | Columnas |
|---|---|---|
| `Usuarios` | **no se copia** (PIN) | — |
| `Rutas` | `Caja_Rutas` | ID, Fecha Solicitud, Fecha Servicio, Usuario, Origen, Destino, KM, Tipo, Motivo, Estado, Valor ($), Fecha Aprobacion, Aprobado Por, Notas, Periodo, Vehiculo |
| `Gastos` o `CajaGastos` | `Caja_Gastos` | ID, Fecha, Usuario, Monto ($), Categoria, Descripcion, Foto URL, Estado, Aprobado Por, Fecha Aprobacion, Periodo |
| `Entregas` o `CajaEntregas` | `Caja_Entregas` | ID, Fecha, Admin, Usuario Destino, Monto ($), Forma, Descripcion, Foto URL, Periodo |
| `Config` | `Caja_Config` | Clave, Valor, Descripcion |
| `Cortes` o `Corte` | `Caja_Cortes` | ID, Periodo, Fecha, Total KM, Total USD, Rutas, Admin, Estado |

La sesión sigue siendo Admin (EFCH / Osvaldo / Secre). No hay PIN de Caja.

## 1. Compartir el libro vivo

1. Abrí el Google Sheet **Minecore App** (`1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY`).
2. Compartir → **Editor** → `estebanferlito@minecore.ec` (la cuenta con la que corre el Apps Script del Admin).
3. No hace falta compartir la copia del 19-sep para esta migración. No la uses como fuente.

## 2. Pegar el script (no borres el motor)

1. Abrí el proyecto Apps Script del **Minecore Admin API** (el de `portal.minecore.ec`, hoy **v124**).
2. **No borres** el archivo del motor ni un parche `dueDate` si ya está.
3. Archivo → Nuevo → nombre `AdminAPI_v127` → pegá el contenido completo de `AdminAPI_v127.gs`.
4. En el `doGet` del motor, la versión pasa a **`v127`** y marcá Caja nativa:

```javascript
return json_({ok:true, service:'Minecore Admin API', version:'v127', cajaNative:true});
```

Si la constante se llama `VERSION` o `API_VERSION`, ponela en `'v127'`.

5. En `doPost`, **después de autenticar** al usuario Admin y **antes** del `switch` o del error de acción desconocida:

```javascript
var cajaOut = cajaDispatch_(p, user);
if (cajaOut) return cajaOut;
```

`p` es el JSON del POST. `user` es la sesión Admin (`usuario` / `nombre` / `rol` / `modulos`).  
Si tu helper de auth se llama distinto, también vale `cajaDispatch_(p, null)`: el dispatcher autentica solo con `user` + `pin` del body.

6. Implementación → Administrar implementaciones → **Nueva versión** (el mismo `/exec`).  
   El `API_URL` del portal no cambia.

## 3. Traer los datos vivos (una vez)

En el editor de Apps Script, con el archivo `AdminAPI_v127` ya guardado:

1. (Opcional) Ejecutá `inspectCajaSource`. En el log, `sourceId` tiene que ser `1TBkb2PgHejJuBmPn84FeUhFUFO7Ws61w8cR1RLDOETY` y `staleCopy` tiene que ser falso. Si ves la copia `1xHmpv…`, paré: el vivo no está compartido.
2. Seleccioná **`migrateCajaSheetsForceFromLive`** y ejecutá (autorizá Drive + Sheets si pide).
3. En el log: `sourceId` = el vivo, `force: true`, `staleCopy: false`, y `copied` con `Caja_Rutas`, `Caja_Gastos`, `Caja_Entregas`, `Caja_Config`, `Caja_Cortes`. `Usuarios` aparece en `skipped`.

Qué hace:

- Lee **solo** `1TBkb…`. Si no abre, corta con error. No cae a la copia del 19-sep.
- Copia esas pestañas a la base Admin `1u8H51MkQ2hyHeQqxDWTH7qCf3a3M57qCzAG-fajLPmY` (o `getProps_().sheetId` si el motor ya lo tiene).
- **Pisa** un destino que ya tenga filas (esta corrida es la de migración).
- No copia `Usuarios` ni nada con PIN.
- Si el origen de una pestaña está vacío, no borra el destino.

`migrateCajaSheets` (sin Force) es la corrida idempotente: vivo primero, y **no pisa** un `Caja_*` que ya tenga filas. También se puede disparar desde Admin (solo rol admin) con `{action:'migrateCajaSheets', user, pin}`. Con `force:true` y `liveOnly:true` equivale a la corrida de arriba.

## 4. Hard-refresh del portal

1. Esperá a que GitHub Pages publique el index **v215**.
2. Abrí `https://portal.minecore.ec/?v=215`.
3. Si sale el banner de versión, abrí el link nuevo (o hard-refresh) y actualizá el bookmark.
4. Entrá con **EFCH**. En el home, el pie tiene que decir **Motor API: v127 ✓**.

## 5. Verificar

### Base Admin

En **Minecore - Datos inFlow** tienen que existir, con filas del libro vivo (no de la foto del 19-sep):

- `Caja_Rutas`
- `Caja_Gastos`
- `Caja_Entregas`
- `Caja_Config`
- `Caja_Cortes`

No tiene que aparecer una copia de `Usuarios` de Caja ni un PIN de Caja.

### Portal

1. Tile **Rutas y Caja Chica**. Sin iframe y sin el script viejo de Minecore App.
2. Balance: los mismos entregado / gastado / disponible que el Caja vivo (corte 26→25).
3. Historial: rutas `R-…` y gastos; la foto abre el link de Drive.
4. Nueva ruta → en `Caja_Rutas`, **Usuario = EFCH**.
5. Gasto con foto → `savePhoto` en Drive (`Minecore Caja Fotos`) y fila Pendiente con **Usuario = EFCH**.
6. Aprobar / rechazar ruta y gasto.
7. Entrega a un colaborador → `Caja_Entregas`, **Admin = EFCH**.
8. Config → precio/km escribe en `Caja_Config`.
9. Cerrar corte escribe en `Caja_Cortes`. La segunda vez el mismo período no duplica.
10. Usuario con solo `caja` (Ver): ve listados y no crea. `caja+` crea; no aprueba ni entrega ni cierra corte, salvo admin.

## 6. Si el pie no dice v127 ✓

El motor desplegado sigue en v124 (o no tiene `cajaDispatch_`). Repetí el paso 2.4–2.6 (versión en `doGet`, cable en `doPost`, **Nueva versión**) y el hard-refresh. Mientras el chip no sea v127, Caja del portal va a responder error del Admin: ya no hay proxy al script viejo.
