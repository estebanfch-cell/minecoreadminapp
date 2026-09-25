# PASTE Admin API — Pick list (foto, ubicación, sububicación)

El portal (index v213) ya arma el PDF. En el iPhone el toque abre el PDF en una pestaña de Safari (se guarda en Archivos desde el visor). No abre solo la hoja de AirDrop.

Si el PDF sale **sin foto** o **sin bodega / bin** (`1-A-2`), el motor no está mandando esos campos. Pega esto en el Apps Script del Admin API y publica una **nueva versión** del mismo deployment.

## 1. Cada producto de `getInventario`

Dentro del objeto que ya devuelves por ítem (`sku`, `nombre`, `img`, `stockPor`, `ubicaciones`…), agrega ubicación, sububicación y la URL de la foto. `inventoryLines` es la forma de inFlow; si tu variable se llama distinto, usa esa.

```javascript
var u = '', subs = [], seen = {};
var lines = p.inventoryLines || p.inventory || [];
lines.forEach(function (ln) {
  var loc = '';
  if (ln.location && typeof ln.location === 'object') loc = ln.location.name || '';
  else loc = ln.locationName || ln.ubicacion || ln.bodega || '';
  if (!u && loc) u = String(loc);
  var sub = ln.sublocation || ln.sububicacion || ln.bin || ln.binName || '';
  sub = String(sub || '').trim();
  if (sub && !seen[sub]) { seen[sub] = 1; subs.push(sub); }
});
var imgObj = p.defaultImage || p.image || {};
var imgUrl = (typeof imgObj === 'string') ? imgObj : (imgObj.mediumUrl || imgObj.largeUrl || imgObj.smallUrl || imgObj.thumbUrl || imgObj.url || '');

item.ubicacion = u;                 // "Bodega Principal"
item.sububicacion = subs.join(' · '); // "1-A-2"
item.img = item.img || imgUrl;
item.ubicaciones = [u, item.sububicacion].filter(Boolean).join(' · ');
```

No pongas la categoría (`BOYLES / BROCAS / NO`) en `ubicacion` ni en `sububicacion`.

## 2. Cada línea de `getOrderDetail` / `getInflowOrdenes`

```javascript
line.img = line.img || imgUrl;          // misma URL que el producto
line.productId = line.productId || '';
line.ubicacion = line.ubicacion || u;
line.sububicacion = line.sububicacion || subs.join(' · ');
```

## 3. Acción `proxyImagen` (solo si la foto no entra al PDF)

El portal dibuja la foto directo si el CDN permite CORS. Si no, pide `{action:'proxyImagen', url, user, pin}` y espera base64. En el `switch` / despacho de acciones:

```javascript
case 'proxyImagen':
  return proxyImagen_(p);
```

```javascript
function proxyImagen_(p) {
  var url = String(p.url || '').trim();
  if (!/^https:\/\//i.test(url)) return json_({ok:false, error:'url'});
  var res = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true});
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) return json_({ok:false, error:'HTTP '+code});
  var blob = res.getBlob();
  var mime = blob.getContentType() || 'image/jpeg';
  if (String(mime).indexOf('image/') !== 0) return json_({ok:false, error:'no es imagen'});
  return json_({ok:true, mime:mime, b64:Utilities.base64Encode(blob.getBytes())});
}
```

`json_` es el helper que ya usas para responder JSON. Si se llama distinto, usa ese.

Después: Implementación → Administrar implementaciones → **Nueva versión**. El `API_URL` del portal no cambia. Hard-refresh del portal (index v213).
