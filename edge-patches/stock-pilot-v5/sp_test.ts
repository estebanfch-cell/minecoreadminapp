import { LOG } from "./fakepg.ts";
Deno.env.set("SHEETS_SECRET", "secreto-local-de-prueba");
Deno.env.set("SUPABASE_DB_URL", "postgres://x:y@localhost:5432/postgres");
let H: any = null; (Deno as any).serve = (h: any) => { H = h; return {} as any; };
await import("../src/index.ts");
const enc = new TextEncoder();
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function tok(u: string, rol = "admin") {
  const k0 = await crypto.subtle.importKey("raw", enc.encode("secreto-local-de-prueba"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", k0, enc.encode("minecore-portal-session-v1")));
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(enc.encode(JSON.stringify({ v: 1, u, r: rol, m: [], iat: now, exp: now + 600 })));
  return p + "." + b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(p))));
}
async function call(u: string, body: any) { const r = await H(new Request("http://x/", { method: "POST", headers: { origin: "https://portal.minecore.ec" }, body: JSON.stringify(Object.assign({ t: await tok(u) }, body)) })); return { st: r.status, j: await r.json() }; }
let fail = 0; const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fail++; };
const BOY = "789e1614-32ce-48dd-a2c9-2a457e7ac798";
// 1) propuesta EFCH con interruptor → enriquecida
const p = await call("EFCH", { op: "propuesta", vendor_id: BOY });
ok(p.st === 200 && p.j.ok, "propuesta EFCH 200");
ok(p.j.lineas_ok === true, "lineas_ok true para EFCH");
ok(p.j.info && Object.keys(p.j.info).length >= (p.j.lineas || []).length, "info para cada línea (" + Object.keys(p.j.info || {}).length + ")");
const l0 = (p.j.lineas || [])[0]; const i0 = l0 && p.j.info[l0.product_id];
ok(!!(i0 && "img" in i0 && "codigo" in i0 && "u365" in i0 && "costo" in i0), "info trae img/codigo/u365/costo");
ok(p.j.imgs && Object.keys(p.j.imgs).length > 0, "imgs para Stock actual (" + Object.keys(p.j.imgs || {}).length + ")");
ok(Array.isArray(p.j.manual), "manual es arreglo");
ok(p.j.niveles && p.j.niveles.alta, "niveles intactos");
// 2) usuario sin interruptor → 403 en ops nuevas y propuesta sin enriquecer (Stock Pilot sigue solo EFCH)
const o = await call("Oswal", { op: "buscar", q: "split", vendor_id: BOY });
ok(o.st === 403, "Oswal buscar → 403 (" + o.st + ")");
const o2 = await call("Oswal", { op: "propuesta", vendor_id: BOY });
ok(o2.st === 403, "Oswal propuesta → 403 (solo EFCH)");
const o3 = await call("Oswal", { op: "minimo_set", product_id: l0?.product_id, minimo: 5 });
ok(o3.st === 403, "Oswal minimo_set → 403");
// 3) búsqueda por nombre / MCOR / código proveedor; filtro proveedor vs todos
const s1 = await call("EFCH", { op: "buscar", q: "ho3 split", vendor_id: BOY });
ok(s1.j.ok && s1.j.productos.some((x: any) => x.sku === "MCOR000450") && s1.j.productos.every((x: any) => x.img !== undefined), "buscar nombre 'ho3 split' → MCOR000450 con info");
const s2 = await call("EFCH", { op: "buscar", q: "MCOR000759", vendor_id: BOY });
ok(s2.j.productos.length === 1 && s2.j.productos[0].sku === "MCOR000759", "buscar MCOR000759");
const s3 = await call("EFCH", { op: "buscar", q: "5827026082301", vendor_id: BOY });
ok(s3.j.productos.some((x: any) => x.sku === "MCOR000759"), "buscar por código proveedor 5827026082301");
const s4 = await call("EFCH", { op: "buscar", q: "separadores", vendor_id: BOY });
const s5 = await call("EFCH", { op: "buscar", q: "separadores", vendor_id: BOY, todos: true });
ok(s4.j.productos.length === 0 && s5.j.productos.length > 0, "filtro proveedor (0) vs todos (" + s5.j.productos.length + ")");
// 4) manual_set / propuesta con manual / manual_del (usuario de prueba = EFCH, producto de prueba que se borra al final)
const PT = s5.j.productos[0].product_id;
const m1 = await call("EFCH", { op: "manual_set", vendor_id: BOY, product_id: PT, cant: 2 });
ok(m1.j.ok && m1.j.linea.cant === 2 && m1.j.linea.precio >= 0, "manual_set sin precio usa precio sugerido");
const m2 = await call("EFCH", { op: "manual_set", vendor_id: BOY, product_id: PT, cant: 3, precio: 9.5 });
ok(m2.j.linea.cant === 3 && m2.j.linea.precio === 9.5, "manual_set edita cant y precio");
const m3 = await call("EFCH", { op: "manual_set", vendor_id: BOY, product_id: PT, cant: 4 });
ok(m3.j.linea.cant === 4 && m3.j.linea.precio === 9.5, "manual_set solo cant conserva precio");
const bad = await call("EFCH", { op: "manual_set", vendor_id: BOY, product_id: PT, cant: 0 });
ok(bad.st === 400, "cant 0 → 400");
const p2 = await call("EFCH", { op: "propuesta", vendor_id: BOY });
ok(p2.j.manual.some((x: any) => x.product_id === PT && x.cant === 4 && x.manual && "img" in x), "propuesta devuelve la línea manual con info");
const d1 = await call("EFCH", { op: "manual_del", vendor_id: BOY, product_id: PT });
const p3 = await call("EFCH", { op: "propuesta", vendor_id: BOY });
ok(d1.j.ok && !p3.j.manual.some((x: any) => x.product_id === PT), "manual_del quita la línea");
// 5) info
const inf = await call("EFCH", { op: "info", vendor_id: BOY, product_ids: [PT] });
ok(inf.j.ok && inf.j.info[PT], "op info");
// 6) sin sesión
const r0 = await H(new Request("http://x/", { method: "POST", body: JSON.stringify({ op: "buscar" }) }));
ok(r0.status === 401, "sin token → 401");
console.log(fail ? "FALLÓ " + fail : "TODO OK", "· SQL ejecutados:", LOG.length);
if (fail) Deno.exit(1);
