// Página pública de una oleada. El token es el único alcance: no acepta un cliente ni devuelve motivo.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
let SQL = null;
const db = () => SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10
});
const ORIG = new Set(["https://portal.minecore.ec", "https://clientes.minecore.ec", "https://estebanfch-cell.github.io"]);
function cors(req) {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIG.has(o) ? o : "https://portal.minecore.ec",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json"
  };
}
function out(req, body, st = 200) {
  return new Response(JSON.stringify(body), { status: st, headers: cors(req) });
}
const enc = new TextEncoder();
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
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
  if (!p || !s || !SECRET) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await key(), unb64u(s), enc.encode(p)); } catch { ok = false; }
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (c.v !== 1 || !c.u || !(c.exp > Date.now() / 1000)) return null;
  return c;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const token = String(b.t || "").trim().toLowerCase().slice(0, 80);
    if (!/^[a-z0-9]{12,40}$/.test(token)) return out(req, { ok: false, error: "Enlace no válido." });
    const q = db();
    if (b.op === "enviar") {
      let contacto = String(b.contacto || "").slice(0, 80);
      let publico = true;
      const ses = await verify(b.sesion);
      if (ses) {
        const [me] = await q`select coalesce(nullif(trim(perfil->>'nombreCompleto'),''), nullif(trim(perfil->>'nombre_completo'),''), '') completo
          from app.portal_users where lower(nombre)=lower(${ses.u}) and coalesce(activo,true) limit 1`;
        const nom = String(me?.completo || "").trim();
        if (nom.length >= 2) { contacto = nom.slice(0, 80); publico = false; }
      }
      const [row] = await q`select app.liq_submit(${token}, ${q.json(Array.isArray(b.lineas) ? b.lineas : [])}, ${contacto}, ${String(b.empresa || "").slice(0, 160)}, ${!!b.todos}, ${String(b.email || "").slice(0, 160)}, ${String(b.telefono || "").slice(0, 40)}, ${publico}, ${String(b.idem || "").slice(0, 80)}, ${String(b.visita || "").slice(0, 160)}, ${!!b.contado}) j`;
      const j = row?.j || { ok: false, error: "Sin respuesta" };
      if (j && j.items) delete j.items;
      return out(req, j);
    }
    const [row] = await q`select app.liq_get(${token}, ${!!b.todos}, false) j`;
    const j = row?.j || { ok: false, error: "Sin respuesta" };
    if (j && j.ok && Array.isArray(j.items)) {
      const cods = await q`select k.sku, k.codigo from app.cliente_codigo k join app.liq_oleadas o on o.customer_id=k.customer_id where o.token=${token}`;
      const m = {};
      cods.forEach((c) => { if (c.sku) m[c.sku] = c.codigo; });
      j.items.forEach((it) => { if (it && m[it.sku]) it.codigo_cliente = m[it.sku]; });
    }
    return out(req, j);
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
