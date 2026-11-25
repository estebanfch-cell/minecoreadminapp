// r452 t2146u: crear cotización de compra (po_reco_cotizar → po_save) con líneas que traen código de proveedor
// (como manda Stock Pilot 724 con líneas manuales). Antes: «num is not defined». SQL simulado, no toca la base.
import { compras } from "../src/compras.ts";
const LOG: string[] = [];
function mk() {
  const rows = (q: string): any[] => {
    if (/doc_next/.test(q)) return [{ n: "MCOR-PQ-TEST01" }];
    if (/insert into app\.purchase_orders/.test(q)) return [{ id: "11111111-1111-1111-1111-111111111111" }];
    if (/from app\.vendors where id/.test(q)) return [{ contact_name: "x", email: "", phone: "", default_payment_terms_id: null, default_carrier: null }];
    if (/insert into app\.product_vendor_codes/.test(q)) return [{ id: 1 }];
    if (/insert into app\.po_outbox/.test(q)) return [{ id: 7 }];
    if (/from app\.purchase_orders where id/.test(q)) return [{ id: "11111111-1111-1111-1111-111111111111", order_number: "MCOR-PQ-TEST01", inventory_status: "quote", version: 1, is_quote: true, total: 0 }];
    return [];
  };
  const render = (s: any, v: any[]) => { let o = ""; (Array.isArray(s) ? s : [String(s)]).forEach((x: string, i: number) => { o += x; if (i < v.length) o += (v[i] && v[i].__q ? v[i].__q : JSON.stringify(v[i] ?? null)); }); return o; };
  const t: any = (s: any, ...v: any[]) => {
    if (!Array.isArray(s) || !(s as any).raw) return { __q: JSON.stringify(s) }; // helper t(obj) / t(arr)
    const q = render(s, v); const f: any = { __q: q }; f.then = (a: any, b: any) => { LOG.push(q); return Promise.resolve(rows(q)).then(a, b); }; return f;
  };
  t.json = (j: any) => ({ __q: JSON.stringify(j) });
  t.begin = async (fn: any) => fn(t);
  t.unsafe = (q: string) => { LOG.push(q); return Promise.resolve([]); };
  return t;
}
const sql = mk();
let fail = 0; const ok = (c: boolean, m: string) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fail++; };
try {
  const r: any = await compras("po_reco_cotizar", { vendor_id: "789e1614-32ce-48dd-a2c9-2a457e7ac798", nota: "Stock Pilot test", lineas: [
    { product_id: "7e11e488-9c57-4537-8003-55debecd5c91", quantity: 5, unit_price: 124.22, description: "HO3 KH SPLIT TUBE 5'", vendor_item_code: "42041008005" },
    { product_id: "04973166-3210-49b3-8451-613366908b0d", quantity: 4, unit_price: 0, description: "BROCA ZAPATA PWT", vendor_item_code: "5827026114800" },
  ] }, sql, "EFCH", "a4b0d9f6-9544-4200-aefa-43ed6c027484", undefined);
  ok(!!r, "po_reco_cotizar con código de proveedor no lanza");
} catch (e) { ok(false, "lanzó: " + String((e as any)?.message || e) + " · último SQL: " + (LOG[LOG.length-1]||"").slice(0,160)); }
const codes = LOG.filter((q) => /insert into app\.product_vendor_codes/.test(q));
ok(codes.length === 2, "guarda los 2 códigos de proveedor (" + codes.length + ")");
ok(codes.every((q) => q.includes('"MCOR-PQ-TEST01"')), "source_ref = número de la cotización");
ok(LOG.some((q) => /insert into app\.po_lines/.test(q)), "inserta líneas");
console.log(fail ? "FALLÓ " + fail : "TODO OK"); if (fail) Deno.exit(1);
