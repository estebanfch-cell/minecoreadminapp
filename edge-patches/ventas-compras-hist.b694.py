"""b694 t1944: refsCompra.hist (últimas 8 OC) + product_vendors.vendor_inflow_id."""
from pathlib import Path
import sys
src = Path(sys.argv[1])
p = src / "compras.ts"
t = p.read_text()
old_init = """        const r = R[x.pid] = R[x.pid] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0
        };"""
new_init = """        const r = R[x.pid] = R[x.pid] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0,
          hist: []
        };"""
if old_init in t:
    t = t.replace(old_init, new_init, 1)
elif "hist: []" not in t:
    raise SystemExit("po_productos init block not found")

needle = "        if (!r.min || x.p < r.min.p) r.min = it;"
add = "        if (!r.min || x.p < r.min.p) r.min = it;\n        if (r.hist.length < 8) r.hist.push(it);"
if "if (r.hist.length < 8) r.hist.push(it);" not in t:
    if needle not in t:
        raise SystemExit("min assignment not found")
    t = t.replace(needle, add, 1)

old_def = """        refsCompra: R[r.id] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0
        }"""
new_def = """        refsCompra: R[r.id] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0,
          hist: []
        }"""
if old_def in t:
    t = t.replace(old_def, new_def, 1)

t = t.replace(
    "select product_id::text pid, vendor_id::text vid, cost::float c from app.product_vendors",
    "select product_id::text pid, vendor_inflow_id::text vid, cost::float c from app.product_vendors",
)
p.write_text(t)
print("patched", p)
