// postgres.js falso: renderiza literales y ejecuta vía Management API (solo pruebas locales)
const TOK = Deno.readTextFileSync("/home/box/.secrets/supabase_access_token").trim();
export const LOG: string[] = [];
function lit(v: any): string {
  if (v && v.__frag) return render(v.s, v.v);
  if (v && v.__json) return "'" + JSON.stringify(v.j).replace(/'/g, "''") + "'::jsonb";
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "ARRAY[" + v.map(lit).join(",") + "]";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function render(s: TemplateStringsArray | string[], v: any[]) { let o = ""; s.forEach((x, i) => { o += x; if (i < v.length) o += lit(v[i]); }); return o; }
async function run(sql: string) {
  LOG.push(sql);
  const r = await fetch("https://api.supabase.com/v1/projects/bklbvwpkrdaojbezljsd/database/query", { method: "POST", headers: { Authorization: "Bearer " + TOK, "User-Agent": "minecore-devops", "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error("SQL " + r.status + " " + t.slice(0, 300));
  return JSON.parse(t);
}
export default function postgres(_u?: any, _o?: any) {
  const q: any = (s: any, ...v: any[]) => { const f: any = { __frag: true, s, v }; f.then = (a: any, b: any) => run(render(s, v)).then(a, b); return f; };
  q.json = (j: any) => ({ __json: true, j });
  return q;
}
