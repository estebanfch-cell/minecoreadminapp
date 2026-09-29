# Portal alineado al pack v128 — `eliminarLineaCaja`

El portal **index v219** ya manda esta acción. El motor v128 del parent la implementa. Este archivo es el contrato que usa la UI. No hace falta otro nombre.

Rechazar sigue siendo el cambio de Estado (`rechazarRuta` / `rechazarGasto`). Eliminar borra la fila de la hoja. No hay filas hijas.

## Quién ve el botón

No es `rol === admin`. Osvaldo y Secre también son admin.

El botón **Eliminar** sale solo si `user` o `nombre` es exactamente `EFCH`, o si empieza con `Esteban`. Confirmación antes de borrar.

## POST

Acción preferida:

```json
{
  "action": "eliminarLineaCaja",
  "id": "E-1710000000000",
  "tipo": "entrega",
  "user": "EFCH",
  "pin": "(PIN de la sesión)"
}
```

`tipo`: `entrega` | `gasto` | `ruta`.

| `tipo` | Hoja |
|---|---|
| `entrega` | `Caja_Entregas` |
| `gasto` | `Caja_Gastos` |
| `ruta` | `Caja_Rutas` |

Alias, con solo `{ id }`:

- `eliminarEntrega`
- `eliminarGasto`
- `eliminarRuta`

Respuesta ok: `{ "ok": true, "deleted": true, "tipo": "entrega", "id": "E-…", "sheet": "Caja_Entregas", "row": 12 }`.

Si no es Esteban / EFCH: `{ "ok": false, "error": "Solo Esteban puede eliminar filas de Caja" }`.

## Balance

No hay saldo guardado.

- entregado = suma de `Caja_Entregas`
- aprobado = suma de gastos con Estado `Aprobado`
- disponible = entregado − aprobado

El portal recarga el historial después de borrar y vuelve a calcular con las filas que quedan. Un corte ya cerrado en `Caja_Cortes` no se reescribe.

`AdminAPI_v127.gs` en este repo ya despacha `eliminarLineaCaja` y los tres alias con la misma regla de nombre. Si el Apps Script en vivo es el pack v128, no reemplaces ese archivo: el portal ya habla ese contrato.
