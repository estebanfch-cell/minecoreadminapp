// Marca una orden como enviada de un toque, la deshace, y dice si el acta
// de una orden enviada ya tiene el ticket o el PDF Recibido.
// No toca stock, pick, pack ni los adjuntos.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
const MARCA = "Marcada enviada";
let SQL = null;
const db = ()=>SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10
});
const enc = new TextEncoder();
const unb64u = (s)=>Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c)=>c.charCodeAt(0));
let KEY = null;
async function key() {
  if (KEY) return KEY;
  const k0 = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", k0, enc.encode("minecore-portal-session-v1")));
  KEY = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return KEY;
}
async function verify(t) {
  const [p, s] = String(t || "").split(".");
  if (!p || !s) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await key(), unb64u(s), enc.encode(p)); } catch { ok = false; }
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (c.v !== 1 || !c.u || !c.r || !Array.isArray(c.m) || !(c.exp > Date.now() / 1000) || c.exp - c.iat > 3600) return null;
  return c;
}
const ORIG = new Set(["https://portal.minecore.ec", "https://clientes.minecore.ec", "https://estebanfch-cell.github.io"]);
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
  return new Response(JSON.stringify(body), { status: st, headers: cors(req) });
}
function nomDe(me) {
  const p = me.perfil || {};
  const n = String(p.nombreCompleto || p.nombre_completo || "").trim();
  return n || String(me.nombre || "");
}
function puede(me) {
  if (me.rol === "admin") return true;
  const m = me.modulos || [];
  return m.includes("cotizaciones+") || m.includes("dashboard+") || m.includes("~pick.e.enviar=1") || m.includes("pick.e.enviar");
}
function uuid(id) {
  return /^[0-9a-f-]{36}$/i.test(String(id || ""));
}
function tsEC(d) {
  try {
    return new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)).replace(",", "") + " (EC)";
  } catch {
    return new Date(d).toISOString();
  }
}
async function quien(q, nombre) {
  const [u] = await q`select perfil from app.portal_users where lower(nombre)=lower(${nombre}) limit 1`;
  const p = u && u.perfil || {};
  const n = String(p.nombreCompleto || p.nombre_completo || "").trim();
  return n || String(nombre || "");
}
async function envioDe(q, id) {
  const [sh] = await q`select carrier, shipped_by, shipped_date from app.so_shipments where sales_order_id=${id}::uuid order by shipped_date desc nulls last limit 1`;
  const [s] = await q`select shipped_date from app.sales_orders where id=${id}::uuid`;
  const por = sh && sh.shipped_by || null;
  const cuando = (sh && sh.shipped_date) || (s && s.shipped_date) || null;
  const nombre = por ? await quien(q, por) : "";
  return {
    por,
    nombre,
    at: cuando ? tsEC(cuando) : "",
    deshacer: !!(sh && sh.carrier === MARCA)
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(()=>({}));
    const c = await verify(b.t);
    if (!c) return out(req, { ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const q = db();
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${c.u}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out(req, { ok: false, error: "Sesión revocada" }, 401);
    const [me] = await q`select nombre, rol, modulos, perfil, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" });
    const actor = String(me.nombre);
    const nombre = nomDe(me);
    if (b.op === "estado") {
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String).filter(uuid))].slice(0, 80);
      if (!ids.length) return out(req, { ok: true, ordenes: [] });
      const rows = await q`select s.id::text id,
        (coalesce(sh.n,0) > 0 or s.shipped_date is not null) enviada,
        exists (
          select 1 from app.so_entregas e
          where e.sales_order_id=s.id and e.estado in ('borrador','entregado')
            and (
              e.pdf_att is not null
              or exists (select 1 from app.so_entrega_fotos f where f.entrega_id=e.id and not coalesce(f.quitada,false) and f.tipo in ('ticket','guia'))
              or exists (select 1 from app.doc_attachments a where a.order_id::text=s.id::text and (a.fuente='Entrega' or a.nombre ilike '%ticket%' or a.nombre ilike '%guía%' or a.nombre ilike '%guia%' or a.nombre ilike 'Recibido %'))
            )
        ) acta,
        sh.carrier, sh.shipped_by, coalesce(sh.shipped_date, s.shipped_date) cuando
        from app.sales_orders s
        left join lateral (
          select count(*)::int n, (array_agg(carrier order by shipped_date desc nulls last))[1] carrier,
            (array_agg(shipped_by order by shipped_date desc nulls last))[1] shipped_by,
            max(shipped_date) shipped_date
          from app.so_shipments where sales_order_id=s.id
        ) sh on true
        where s.id::text = any(${ids}::text[])`;
      const nombres = {};
      for (const r of rows) {
        if (r.shipped_by && nombres[r.shipped_by] == null) nombres[r.shipped_by] = await quien(q, r.shipped_by);
      }
      return out(req, {
        ok: true,
        ordenes: rows.map((r)=>({
          id: r.id,
          acta: !!(r.enviada && r.acta),
          por: r.shipped_by || null,
          nombre: r.shipped_by ? nombres[r.shipped_by] : "",
          at: r.cuando ? tsEC(r.cuando) : "",
          deshacer: r.carrier === MARCA
        }))
      });
    }
    if (!puede(me)) return out(req, { ok: false, error: "Sin permiso para marcar el envío" });
    const id = String(b.id || "");
    if (!uuid(id)) return out(req, { ok: false, error: "Orden no válida" });
    const [s] = await q`select id, is_quote, is_cancelled, shipped_date from app.sales_orders where id=${id}::uuid`;
    if (!s || s.is_quote || s.is_cancelled) return out(req, { ok: false, error: "La orden no está abierta" });
    if (b.op === "marcar") {
      const [ya] = await q`select id from app.so_shipments where sales_order_id=${id}::uuid limit 1`;
      if (!ya && !s.shipped_date) {
        const now = new Date();
        await q`insert into app.so_shipments (sales_order_id, carrier, tracking_number, containers, shipped_date, shipped_by)
          values (${id}::uuid, ${MARCA}, null, null, ${now}, ${actor})`;
        await q`update app.sales_orders set shipped_date=coalesce(shipped_date, ${now}), version=version+1 where id=${id}::uuid`;
        await q`insert into app.audit_log (actor, accion, tabla, ref_id, detalle)
          values (${actor}, 'envio_marcar', 'sales_orders', ${id}::uuid, ${q.json({ nombre, marca: MARCA })})`.catch(()=>{});
      }
      const e = await envioDe(q, id);
      return out(req, { ok: true, enviada: true, por: e.por || actor, nombre: e.nombre || nombre, at: e.at || tsEC(new Date()), deshacer: e.deshacer });
    }
    if (b.op === "deshacer") {
      const [sh] = await q`select id, carrier from app.so_shipments where sales_order_id=${id}::uuid and carrier=${MARCA} order by shipped_date desc nulls last limit 1`;
      if (!sh) return out(req, { ok: false, error: "Este envío tiene transportista y guía. No se deshace desde aquí." });
      await q`delete from app.so_shipments where id=${sh.id}`;
      const [rest] = await q`select count(*)::int n, max(shipped_date) d from app.so_shipments where sales_order_id=${id}::uuid`;
      if (!rest.n) await q`update app.sales_orders set shipped_date=null, version=version+1 where id=${id}::uuid`;
      else await q`update app.sales_orders set shipped_date=coalesce(${rest.d}, shipped_date), version=version+1 where id=${id}::uuid`;
      await q`insert into app.audit_log (actor, accion, tabla, ref_id, detalle)
        values (${actor}, 'envio_deshacer', 'sales_orders', ${id}::uuid, ${q.json({ nombre })})`.catch(()=>{});
      const e = await envioDe(q, id);
      const [queda] = await q`select shipped_date, (select count(*)::int from app.so_shipments where sales_order_id=${id}::uuid) n from app.sales_orders where id=${id}::uuid`;
      const enviada = !!(queda && (queda.n > 0 || queda.shipped_date));
      return out(req, { ok: true, enviada, por: e.por, nombre: e.nombre, at: e.at, deshacer: e.deshacer });
    }
    if (b.op === "cerrar") {
      const [r] = await q`update app.sales_orders s
        set entregado_at=coalesce(s.entregado_at, e.entregado_at, now()),
            entregado_por=coalesce(s.entregado_por, e.entregado_por, ${actor})
        from app.so_entregas e
        where s.id=${id}::uuid and e.sales_order_id=s.id and e.estado='entregado' and e.pdf_att is not null
          and s.entregado_at is null
          and coalesce((app.so_recibido(s.id)->>'completo')::boolean, false)
        returning s.entregado_at`;
      return out(req, { ok: true, sellada: !!r });
    }
    return out(req, { ok: false, error: "Operación no válida" });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
