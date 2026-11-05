# Etiquetas clientes → DYMO Wireless

Esto no está conectado al portal en producción. El botón del portal no envía trabajos. La migración SQL no se aplicó. No hay token de puente.

## Qué ya queda en el portal

- Interruptor por usuario `~prep.e.etiq` (apagado hasta que alguien lo encienda y guarde). No cambia el rol.
- En Preparar orden y en Entregar orden, quien tenga ese permiso ve «Imprimir etiquetas».
- El clic dice que no se envió nada. El PDF 19×51 de siempre sigue en Pack y dentro de ese recuadro.
- Imprimir no confirma la preparación ni mueve stock.

El interruptor viaja en `saveUser`, que ya existe. Si el servidor ignorara un permiso desconocido, el perfil no volvería con `~prep.e.etiq=1` y el botón no aparece.

## Qué falta para que salga una etiqueta de verdad

1. Publicar en `portal-api` / `ventas-api` las operaciones de `etiq/queue.mjs`: `enqueue`, `status`, `retry`, `reprint` (sesión del portal) y `heartbeat`, `claim`, `report` (token de puente). Misma regla: sin `~prep.e.etiq=1`, o sin permiso de preparar/entregar, o si la OV no es de quien pide, se niega. El documento lo arma el servidor desde la OV, no el navegador.
2. Aplicar `etiq/schema.sql` en el esquema `app` del proyecto `bklbvwpkrdaojbezljsd`. Hoy no está aplicado.
3. Alta del puente: un token largo, al azar, guardado solo como hash. Se muestra una vez. Se puede revocar. No es la credencial de servicio y no va en el navegador ni en este repositorio.
4. En el iMac de bodega (Catalina 10.15), cuando el controlador de la LabelWriter Wireless imprima bien en local: instalar Python 3.8 de python.org (el sistema no trae Python 3), copiar `etiq/bridge.py`, llenar `~/.minecore-dymo/bridge.conf` desde el ejemplo, `chmod 600`, y solo entonces cargar el plist. La cola CUPS se escribe a mano con el nombre real de esa Mac. No es la cola del mini.
5. Recién ahí, en un build posterior, pasar `LIVE` a true en `etiq/panel.js` después de ver una respuesta `etiq: 1` y `physically_printed: false`.

El puente solo sale por HTTPS. No abre puertos ni publica CUPS. Un trabajo aceptado por CUPS no se muestra como etiqueta ya impresa. Si el envío queda incierto, no se manda otra sola.

## Compatibilidad

`bridge.py` está escrito para Python 3.8 y CUPS. No se ejecutó en el iMac. `COMPAT["validated_on_target"]` es false.
