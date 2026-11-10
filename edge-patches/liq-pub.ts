// Página pública de una oleada. El token es el único alcance: no acepta un cliente ni devuelve motivo.
import postgres from "npm:postgres@3.4.4";
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const token = String(b.t || "").trim().toLowerCase().slice(0, 80);
    if (!/^[a-z0-9]{12,40}$/.test(token)) return out(req, { ok: false, error: "Enlace no válido." });
    const q = db();
    if (b.op === "enviar") {
      const [row] = await q`select app.liq_submit(${token}, ${q.json(Array.isArray(b.lineas) ? b.lineas : [])}, ${String(b.contacto || "").slice(0, 80)}, ${String(b.empresa || "").slice(0, 160)}, ${!!b.todos}) j`;
      const j = row?.j || { ok: false, error: "Sin respuesta" };
      if (j && j.items) delete j.items;
      return out(req, j);
    }
    const [row] = await q`select app.liq_get(${token}, ${!!b.todos}, false) j`;
    return out(req, row?.j || { ok: false, error: "Sin respuesta" });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
