// Aplica descuento de línea al 100% después del guardado normal (ventas-api sigue en 0-99).
// Solo admin o ~ov.e.desc100=1. No toca stock. Recalcula subtotal, IVA y total.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
let SQL = null;
const db = ()=>SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10
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
    const [me] = await q`select nombre, rol, modulos, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" });
    const mods = me.modulos || [];
    const puede = me.rol === "admin" || mods.includes("~ov.e.desc100=1");
    if (!puede) return out(req, { ok: false, error: "Descuento inválido (0-99%)" });
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Orden no válida" });
    const ped = Array.isArray(b.lineas) ? b.lineas : [];
    if (!ped.length) return out(req, { ok: true, n: 0 });
    let n = 0;
    await q.begin(async (t)=>{
      for (const l of ped){
        const lid = /^[0-9a-f-]{36}$/i.test(String(l.id || "")) ? String(l.id) : null;
        const pid = /^[0-9a-f-]{36}$/i.test(String(l.product_id || "")) ? String(l.product_id) : null;
        const qty = Number(l.quantity), pu = Number(l.unit_price);
        if (!Number.isFinite(qty) || !Number.isFinite(pu)) throw new Error("Línea inválida");
        const rows = await t`update app.sales_order_lines l set discount_pct=100, discount_is_percent=true, subtotal=0, discount_value=round((l.quantity*l.unit_price)::numeric, 2)
          where l.id in (
            select id from app.sales_order_lines
            where sales_order_id=${id}::uuid
              and (${lid}::uuid is null or id=${lid}::uuid)
              and (${pid}::uuid is null or product_id=${pid}::uuid)
              and abs(quantity-${qty})<1e-6
              and abs(unit_price-${pu})<1e-4
              and discount_pct>=99 and discount_pct<100
              and not coalesce(is_discarded,false)
            order by line_num limit 1
          ) returning l.id`;
        if (rows.length) { n++; continue; }
        const [ya] = await t`select 1 from app.sales_order_lines
          where sales_order_id=${id}::uuid
            and (${lid}::uuid is null or id=${lid}::uuid)
            and (${pid}::uuid is null or product_id=${pid}::uuid)
            and abs(quantity-${qty})<1e-6 and abs(unit_price-${pu})<1e-4
            and discount_pct>=100 and not coalesce(is_discarded,false) limit 1`;
        if (!ya) throw new Error("No encontré la línea para dejarla en $0");
        n++;
      }
      await t`update app.sales_orders s set subtotal=x.st, discount_total=x.dt,
          tax1=round((x.st*coalesce(s.tax1_rate,15)/100)::numeric, 2),
          total=round((x.st + x.st*coalesce(s.tax1_rate,15)/100 + coalesce(s.freight,0))::numeric, 2)
        from (select coalesce(sum(subtotal),0) st, coalesce(sum(discount_value),0) dt from app.sales_order_lines where sales_order_id=${id}::uuid and not coalesce(is_discarded,false)) x
        where s.id=${id}::uuid`;
      await t`update app.sales_orders s set amount_paid=p.a,
          balance=case when p.a>0 and s.total-p.a between -0.05 and 0.05 then 0 else round((s.total-p.a)::numeric,2) end,
          payment_status=case when s.is_quote then 'quote' when p.a>=s.total-0.05 and s.total>0 then 'paid' when p.a>0 then 'partial' when s.is_invoiced then 'invoiced' else 'uninvoiced' end
        from (select coalesce(sum(amount),0) a from app.so_payments where sales_order_id=${id}::uuid) p
        where s.id=${id}::uuid`;
    });
    const [tot] = await q`select subtotal::float st, tax1::float iva, total::float total from app.sales_orders where id=${id}::uuid`;
    return out(req, { ok: true, n, subtotal: tot?.st ?? 0, iva: tot?.iva ?? 0, total: tot?.total ?? 0 });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
