# -*- coding: utf-8 -*-
"""Lo mismo que importa el iMac: CPython 2.7, sin f-strings ni urllib de Python 3."""
from __future__ import print_function

import io
import os
import stat
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etiq"))
import bridge  # noqa: E402


TOKEN = u"prueba-token-123456"
LABEL = {
    "profile": "clientes",
    "width_mm": 51,
    "height_mm": 19,
    "paper": "30330",
    "copies": 1,
    "fields": {
        "nombre": u"NI\u00d1ON DE PRUEBA LARGO",
        "sku": u"PRUEBA000261",
        "qty": u"3",
        "ov": u"PRUEBA-SO-001285-1",
    },
}


def check(cond, msg):
    if not cond:
        raise SystemExit(msg)


def main():
    src_path = bridge.__file__
    if src_path.endswith(".pyc"):
        src_path = src_path[:-1]
    src = io.open(src_path, "r", encoding="utf-8").read()
    for banned in ("CERT_NONE", "check_hostname = False", "shell=True", "subprocess.run", "async def", "yield from"):
        check(banned not in src, banned)
    ctx = bridge.https_context()
    check(ctx.verify_mode == bridge.ssl.CERT_REQUIRED, "verify")
    check(ctx.check_hostname is True, "hostname")

    rows, pt, sw, qw, ow = bridge.place_ids(u"PRUEBA000261", u"\u00d73", u"PRUEBA-SO-001285-1")
    check(rows == 1, "filas")
    check(pt >= 5.4, "pt")
    rows2, pt2, sw2, qw2, ow2 = bridge.place_ids(u"PRUEBA000261", u"\u00d712", u"PRUEBA-SO-001044-5-2")
    check(rows2 == 1, "el SO largo bajo de fila")
    check(pt2 < pt, "no achico")
    check(sw2 + (1.15 / 25.4 * 72.0) + qw2 + (2.4 / 25.4 * 72.0) + ow2 <= (51.0 - 3.0) / 25.4 * 72.0 + 0.5, "solape")
    # Un solo tamaño para SKU, cantidad y OV: place_ids devuelve un pt.
    check(pt2 == pt2, "tamano")

    raw = bridge.render_pdf([LABEL])
    check(raw.startswith(b"%PDF-1.4"), "pdf")
    text = raw.decode("latin-1")
    for word in (u"NI\u00d1ON", u"DE", u"PRUEBA", u"LARGO", u"PRUEBA000261", u"PRUEBA-SO-001285-1"):
        check(word.encode("latin-1") in raw, "falta " + word.encode("ascii", "replace"))
    check(b"\xd7" in raw, "cantidad")

    home = tempfile.mkdtemp()
    conf = os.path.join(home, "bridge.conf")
    spec = os.path.join(home, "code.json")
    io.open(spec, "w", encoding="utf-8").write(u'{"code":"AB23CD45EF67","queue":"DYMO_PRUEBA"}\n')
    os.chmod(spec, 0o600)
    seen = {}

    class Res(object):
        def read(self):
            return ('{"ok":true,"token":"%s","physically_printed":false,"etiq":1}' % TOKEN).encode("utf-8")

        def close(self):
            return None

    def opener(req):
        seen["url"] = req.get_full_url()
        seen["pair"] = req.get_header("X-etiq-pair")
        seen["bridge"] = req.get_header("X-etiq-bridge")
        seen["body"] = req.data
        return Res()

    old = sys.stdout
    buf = io.BytesIO() if False else io.StringIO()
    sys.stdout = buf
    try:
        bridge.vincular(spec, conf_path=conf, opener=opener)
    finally:
        sys.stdout = old
    out = buf.getvalue()
    check(TOKEN not in out, "token en stdout")
    check("AB23CD45EF67" not in out, "codigo en stdout")
    check(not os.path.exists(spec), "quedo el codigo")
    check(seen["pair"] == "1", "header pair")
    check(not seen["bridge"], "token en header de vincular")
    check("ventas-api" in seen["url"], "url")
    check("portal-api" not in seen["url"], "portal")
    check(TOKEN.encode("utf-8") not in seen["body"], "token en el cuerpo")
    body = io.open(conf, "r", encoding="utf-8").read()
    check(TOKEN in body, "conf")
    check("DYMO_PRUEBA" in body, "cola")
    check(stat.S_IMODE(os.stat(conf).st_mode) == 0o600, "modo")
    check(TOKEN not in repr(seen["url"]), "token en url")

    loose = os.path.join(home, "loose.json")
    io.open(loose, "w", encoding="utf-8").write(u"{}\n")
    os.chmod(loose, 0o644)
    try:
        bridge.vincular(loose, conf_path=conf, opener=opener)
        raise SystemExit("acepto archivo holgado")
    except ValueError:
        pass

    print("etiq_bridge_py27 OK", sys.version.split()[0])


if __name__ == "__main__":
    main()
