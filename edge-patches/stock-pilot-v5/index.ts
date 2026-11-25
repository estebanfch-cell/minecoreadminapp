// Stock Pilot: propuesta solo EFCH. Venta puntual: admin, no toca stock ni precios.
// b724 t2135u/t2137u (v5): interruptor ~sp.e.lineas → fotos/info por línea, líneas agregadas a mano (app.stock_pilot_manual), búsqueda de catálogo, mínimo fijo por producto (admin).
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
let SQL = null;
const db = ()=>SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30
  });
const enc = new TextEncoder();
const unb64u = (s)=>Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c)=>c.charCodeAt(0));
let KEY = null;
async function key() {
  if (KEY) return KEY;
  const k0 = await crypto.subtle.importKey("raw", enc.encode(SECRET), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", k0, enc.encode("minecore-portal-session-v1")));
  KEY = await crypto.subtle.importKey("raw", raw, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "verify"
  ]);
  return KEY;
}
async function verify(t) {
  const [p, s] = String(t || "").split(".");
  if (!p || !s) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await key(), unb64u(s), enc.encode(p));
  } catch  {
    ok = false;
  }
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (c.v !== 1 || !c.u || !c.r || !Array.isArray(c.m) || !(c.exp > Date.now() / 1000) || c.exp - c.iat > 3600) return null;
  return c;
}
const LINEAS_TOK = "~sp.e.lineas=1";
const UU = (x)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x || "")) ? String(x) : null;
// b724: foto/código/rotación/costo por línea + líneas manuales del usuario para este proveedor + foto en «Stock actual»
async function enriquecer(q, me, j) {
  const vid = UU(j?.proveedor?.id);
  const man = vid ? await q`select product_id::text product_id, cant::float cant, precio::float precio from app.stock_pilot_manual where usuario=${me.nombre} and vendor_id=${vid}::uuid order by created_at` : [];
  const ids = new Set();
  for (const l of (Array.isArray(j?.lineas) ? j.lineas : []))if (UU(l.product_id)) ids.add(String(l.product_id));
  for (const m of man)ids.add(m.product_id);
  const info = ids.size ? (await q`select app.stock_pilot_info(${[...ids]}::uuid[], ${vid}::uuid) j`)[0]?.j || {} : {};
  const skus = (Array.isArray(j?.stock) ? j.stock : []).map((x)=>String(x.sku || "")).filter(Boolean).slice(0, 600);
  const imgs = {};
  if (skus.length) for (const r of await q`select sku, img, nullif(codigo,'') codigo from app.v_inventario_portal where sku = any(${skus}::text[])`)imgs[r.sku] = { img: r.img || null, codigo: r.codigo || null };
  return {
    info,
    imgs,
    manual: man.map((m)=>Object.assign({}, info[m.product_id] || { product_id: m.product_id }, { cant: m.cant, precio: m.precio, manual: true })),
    es_admin: me.rol === "admin"
  };
}
const ORIG = new Set([
  "https://portal.minecore.ec",
  "https://clientes.minecore.ec",
  "https://estebanfch-cell.github.io"
]);
function cors(req) {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIG.has(o) ? o : "https://portal.minecore.ec",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json"
  };
}
function out(req, body, st = 200) {
  return new Response(JSON.stringify(body), {
    status: st,
    headers: cors(req)
  });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors(req)
  });
  if (req.method !== "POST") return out(req, {
    ok: false,
    error: "POST"
  }, 405);
  try {
    const b = await req.json().catch(()=>({}));
    const c = await verify(b.t);
    if (!c) return out(req, {
      ok: false,
      error: "Sesión vencida. Vuelve a entrar."
    }, 401);
    const q = db();
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${c.u}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out(req, {
      ok: false,
      error: "Sesión revocada"
    }, 401);
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo, coalesce(modulos, '{}'::text[]) modulos from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, {
      ok: false,
      error: "Sin permiso"
    }, 403);
    const op = String(b.op || "propuesta");
    if (op === "propuesta") {
      if (String(me.nombre).toUpperCase() !== "EFCH") return out(req, {
        ok: false,
        error: "Stock Pilot está solo para EFCH."
      }, 403);
      const vid = /^[0-9a-f-]{36}$/i.test(String(b.vendor_id || "")) ? String(b.vendor_id) : null;
      const regla = b.regla_tuberia === false ? false : true;
      const [row] = vid ? await q`select app.stock_pilot_propuesta(${vid}::uuid, ${regla}) j` : await q`select app.stock_pilot_propuesta(null, ${regla}) j`;
      const j = row?.j || {};
      const mods = Array.isArray(me.modulos) ? me.modulos : [];
      const niveles_ok = mods.some((x)=>String(x) === "~sp.e.niveles=1");
      const lineas_ok = mods.some((x)=>String(x) === LINEAS_TOK);
      const extra = lineas_ok ? await enriquecer(q, me, j) : {};
      return out(req, Object.assign({
        ok: true,
        niveles_ok,
        lineas_ok
      }, j, extra));
    }
    if (op === "buscar" || op === "manual_set" || op === "manual_del" || op === "info" || op === "minimo_set") {
      const mods = Array.isArray(me.modulos) ? me.modulos : [];
      if (!mods.some((x)=>String(x) === LINEAS_TOK)) return out(req, {
        ok: false,
        error: "Sin permiso: «Stock Pilot: fotos, agregar y quitar líneas» está apagado para tu usuario."
      }, 403);
      const vid = UU(b.vendor_id);
      if (op === "buscar") {
        const txt = String(b.q || "").trim().slice(0, 80);
        if (txt.length < 2) return out(req, { ok: true, productos: [] });
        const [r] = await q`select app.stock_pilot_buscar(${txt}, ${vid}::uuid, ${!!b.todos}) ids`;
        const ids = (r?.ids || []).map(String);
        const info = ids.length ? (await q`select app.stock_pilot_info(${ids}::uuid[], ${vid}::uuid) j`)[0]?.j || {} : {};
        return out(req, { ok: true, productos: ids.map((id)=>info[id]).filter(Boolean) });
      }
      if (op === "info") {
        const ids = (Array.isArray(b.product_ids) ? b.product_ids : []).map(UU).filter(Boolean).slice(0, 300);
        const info = ids.length ? (await q`select app.stock_pilot_info(${ids}::uuid[], ${vid}::uuid) j`)[0]?.j || {} : {};
        return out(req, { ok: true, info });
      }
      if (op === "minimo_set") {
        if (me.rol !== "admin") return out(req, { ok: false, error: "Solo un administrador puede cambiar el mínimo fijo." }, 403);
        const pid = UU(b.product_id);
        if (!pid) return out(req, { ok: false, error: "Producto no válido" }, 400);
        const raw = b.minimo;
        const mn = raw === null || raw === "" || raw === undefined ? null : Number(raw);
        if (mn !== null && !(Number.isFinite(mn) && mn >= 0 && mn <= 100000)) return out(req, { ok: false, error: "Mínimo inválido" }, 400);
        const [old] = await q`select minimo from app.product_stock_minimo where product_id=${pid}::uuid`;
        if (mn === null || mn === 0) await q`delete from app.product_stock_minimo where product_id=${pid}::uuid`;
        else await q`insert into app.product_stock_minimo(product_id, minimo, por, updated_at) values (${pid}::uuid, ${mn}, ${me.nombre}, now()) on conflict (product_id) do update set minimo=excluded.minimo, por=excluded.por, updated_at=now()`;
        await q`insert into app.product_stock_minimo_log(product_id, anterior, nuevo, por) values (${pid}::uuid, ${old?.minimo ?? null}, ${mn || null}, ${me.nombre})`;
        return out(req, { ok: true, product_id: pid, minimo: mn || null });
      }
      if (!vid) return out(req, { ok: false, error: "Proveedor no válido" }, 400);
      const pid = UU(b.product_id);
      if (!pid) return out(req, { ok: false, error: "Producto no válido" }, 400);
      if (op === "manual_del") {
        await q`delete from app.stock_pilot_manual where usuario=${me.nombre} and vendor_id=${vid}::uuid and product_id=${pid}::uuid`;
        return out(req, { ok: true });
      }
      const cant = Number(b.cant), precio = b.precio === undefined || b.precio === null || b.precio === "" ? null : Number(b.precio);
      if (!(Number.isFinite(cant) && cant > 0 && cant <= 100000)) return out(req, { ok: false, error: "Cantidad inválida" }, 400);
      if (precio !== null && !(Number.isFinite(precio) && precio >= 0)) return out(req, { ok: false, error: "Precio inválido" }, 400);
      const [pv] = await q`select id from app.products where id=${pid}::uuid`;
      if (!pv) return out(req, { ok: false, error: "Producto no existe" }, 404);
      let pr = precio;
      if (pr === null) {
        const [x] = await q`select app.stock_pilot_info(array[${pid}]::uuid[], ${vid}::uuid) j`;
        pr = Number(x?.j?.[pid]?.precio || 0);
      }
      const [row] = await q`insert into app.stock_pilot_manual(usuario, vendor_id, product_id, cant, precio, creado_por) values (${me.nombre}, ${vid}::uuid, ${pid}::uuid, ${cant}, ${pr}, ${me.nombre})
        on conflict (usuario, vendor_id, product_id) do update set cant=excluded.cant, precio=${precio === null ? q`app.stock_pilot_manual.precio` : q`excluded.precio`}, updated_at=now()
        returning product_id::text product_id, cant::float cant, precio::float precio`;
      return out(req, { ok: true, linea: row });
    }
    if (me.rol !== "admin") return out(req, {
      ok: false,
      error: "Solo un administrador puede marcar venta puntual."
    }, 403);
    if (op === "flags") {
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, {
        ok: false,
        error: "Orden no válida"
      }, 400);
      const rows = await q`select id::text id, coalesce(venta_puntual,false) venta_puntual from app.sales_order_lines where sales_order_id=${id}::uuid`;
      const flags = {};
      for (const r of rows)flags[r.id] = !!r.venta_puntual;
      return out(req, {
        ok: true,
        flags
      });
    }
    if (op === "set") {
      const lid = String(b.line_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(lid)) return out(req, {
        ok: false,
        error: "Línea no válida"
      }, 400);
      const valor = !!b.valor;
      const [ln] = await q`update app.sales_order_lines set venta_puntual=${valor}, venta_puntual_por=${me.nombre}, venta_puntual_at=now() where id=${lid}::uuid returning id::text id, sales_order_id, venta_puntual, sku, quantity`;
      if (!ln) return out(req, {
        ok: false,
        error: "Línea no encontrada"
      }, 404);
      await q`insert into app.so_audit(actor, op, sales_order_id, data) values (${me.nombre}, 'venta_puntual', ${ln.sales_order_id}, ${q.json({
        line_id: ln.id,
        sku: ln.sku,
        cantidad: ln.quantity,
        venta_puntual: valor
      })})`;
      return out(req, {
        ok: true,
        venta_puntual: ln.venta_puntual,
        line_id: ln.id
      });
    }
    return out(req, {
      ok: false,
      error: "Acción desconocida"
    }, 400);
  } catch (e) {
    return out(req, {
      ok: false,
      error: String(e?.message || e)
    }, 500);
  }
});
