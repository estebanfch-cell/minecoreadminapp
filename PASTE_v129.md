# PASTE AdminAPI v129 — Caja: anti-duplicado + fecha d/M/yyyy

Incremental sobre **v128**. Proyecto Apps Script: **Minecore inFlow Sync**
(`1XmRvRFwGkOzg_WPix-kD4UtUvD5rJjHYuBX3DgVsTBZERjmnt08-JEfL`). Portal que lo usa: index **v220**.

## Qué cambia
- `crearEntrega` / `crearGasto` / `crearRuta` pasan por `cajaIdemCreate_`:
  - `LockService.getScriptLock()` (serializa altas simultáneas).
  - `clientReqId` que manda el portal (mismo valor en cada reintento) → si ya se guardó, devuelve el mismo `id` con `dedup:'clientReqId'` sin insertar (CacheService 6 h).
  - Huella de contenido (admin/destino/monto/forma/descripción/foto; gastos: usuario/monto/categoría/descripción/foto) en < 2 min → devuelve el `id` existente (`dedup:'contenido'`).
- `Fecha` de `Caja_Entregas` y `Caja_Gastos` se guarda como **fecha real** con formato `d/M/yyyy` (antes texto ISO `…T18:22:15.885Z`).
- Columna `Admin` (Caja_Entregas) y `Aprobado Por`: helper `cajaWho_` (en v128 `Admin` quedaba vacío en las altas nativas).
- `cajaDoGetHint_` → `version:'v129'`, `cajaIdem:true`.

## Pasos (≈2 min)
1. Abrí https://script.google.com/home/projects/1XmRvRFwGkOzg_WPix-kD4UtUvD5rJjHYuBX3DgVsTBZERjmnt08-JEfL/edit
2. Abrí el archivo `AdminAPI_v128` → renombralo a `AdminAPI_v129` → **seleccioná todo y reemplazá** con el contenido de `AdminAPI_v129.gs`. (No dejes otro archivo con `cajaDispatch_`.)
3. En el `doGet` del motor cambiá `version:'v128'` → `version:'v129'` (dejá `cajaNative:true`).
4. Guardar (Ctrl+S).
5. **Implementar → Administrar implementaciones → (implementación actual, la 159) → ✏️ Editar → Versión: «Nueva versión»** → descripción «v129 caja anti-duplicado» → **Implementar**. Misma URL `/exec`, no cambia nada en el portal.
6. Verificá: abrí la URL `/exec` en el navegador → debe decir `"version":"v129"`.
7. (Recomendado) Admin DB → Archivo → Configuración → Zona horaria = **(GMT-05:00) Guayaquil**, para que `d/M/yyyy` caiga en el día correcto.

No hay secretos en este archivo; no hace falta tocar Propiedades del script.
