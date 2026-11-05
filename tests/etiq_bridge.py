# -*- coding: utf-8 -*-
"""Puente con CUPS simulado y datos de prueba. No imprime y no habla con Supabase."""
import ast
import io
import os
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etiq"))
import bridge  # noqa: E402


LABEL = {
    "profile": "clientes",
    "width_mm": 51,
    "height_mm": 19,
    "paper": "30330",
    "copies": 1,
    "fields": {
        "nombre": "PRODUCTO DE PRUEBA",
        "sku": "PRUEBA-SKU",
        "qty": "3",
        "ov": "PRUEBA-SO-0001",
    },
}


class Cups(object):
    def __init__(self, mode):
        self.mode = mode
        self.calls = []

    def __call__(self, argv, timeout):
        self.calls.append(list(argv))
        if argv[0] == "lpstat":
            if self.mode == "offline":
                return 0, "printer DYMO_PRUEBA is idle. enabled since today\nprinter DYMO_PRUEBA disabled\n", ""
            if self.mode == "missing":
                return 1, "", "unknown printer"
            return 0, "printer DYMO_PRUEBA is idle. enabled since today\n", ""
        if self.mode == "timeout":
            raise subprocess.TimeoutExpired(argv, timeout)
        if self.mode == "error":
            return 1, "", "printer not ready"
        if self.mode == "muddy":
            return 0, "ok without id", ""
        if self.mode == "both":
            return 1, "request id is DYMO_PRUEBA-9 (1 file(s))\n", "error after accept"
        return 0, "request id is DYMO_PRUEBA-7 (1 file(s))\n", ""


def job(extra=None):
    base = {"id": "job-prueba", "labels": [dict(LABEL)]}
    if extra:
        base.update(extra)
    return base


class BridgeTest(unittest.TestCase):
    def test_compat_honest(self):
        self.assertFalse(bridge.COMPAT["validated_on_target"])
        self.assertIn("10.15", bridge.COMPAT["os_target"])
        with open(bridge.__file__, encoding="utf-8") as handle:
            src = handle.read()
        tree = ast.parse(src)
        banned = tuple(getattr(ast, name) for name in ("Match", "NamedExpr", "JoinedStr", "AsyncFunctionDef") if hasattr(ast, name))
        for node in ast.walk(tree):
            self.assertFalse(isinstance(node, banned), type(node).__name__)
        self.assertNotIn("shell=True", src)
        self.assertNotIn("service_role", src)
        self.assertNotIn(".listen(", src)
        self.assertNotIn("HTTPServer", src)

    def test_config_refuses_loose_file_and_bad_host(self):
        fd, path = tempfile.mkstemp()
        os.write(fd, b"BRIDGE_TOKEN=prueba-token-123456\nCUPS_QUEUE=DYMO_PRUEBA\nAPI_BASE=https://evil.example/x\n")
        os.close(fd)
        os.chmod(path, 0o644)
        with self.assertRaises(ValueError):
            bridge.load_config(path)
        os.chmod(path, 0o600)
        with self.assertRaises(ValueError):
            bridge.load_config(path)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("BRIDGE_TOKEN=\nCUPS_QUEUE=DYMO_PRUEBA\n")
        with self.assertRaises(ValueError):
            bridge.load_config(path)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("BRIDGE_TOKEN=prueba-token-123456\nCUPS_QUEUE=\n")
        with self.assertRaises(ValueError):
            bridge.load_config(path)
        os.remove(path)
        with self.assertRaises(ValueError):
            bridge.resolve_base("http://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api")
        with self.assertRaises(ValueError):
            bridge.resolve_base("https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/portal-api")
        ok = bridge.resolve_base("https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api")
        self.assertEqual(ok, "https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api")

    def test_pdf_size_and_fields(self):
        raw = bridge.render_pdf([LABEL])
        self.assertTrue(raw.startswith(b"%PDF-1.4"))
        text = raw.decode("latin-1", "replace")
        self.assertIn("PRODUCTO DE PRUEBA", text)
        self.assertIn("PRUEBA-SKU", text)
        width = round(51.0 / 25.4 * 72.0, 2)
        height = round(19.0 / 25.4 * 72.0, 2)
        self.assertIn("%.2f %.2f" % (width, height), text)

    def test_rejects_bodega_shell_and_url(self):
        cups = Cups("ok")
        seen = []

        def transport(op, body):
            seen.append((op, body))
            if op == "claim":
                bad = job({"profile_override": True, "url": "https://evil.example", "shell": "lp -d x"})
                return {"job": bad, "attempt_id": "att-1", "etiq": 1, "physically_printed": False}
            return {"etiq": 1, "physically_printed": False}

        out = bridge.step(transport, "DYMO_PRUEBA", cups)
        self.assertEqual(out["lp"], 0)
        self.assertEqual(out["did"], "rejected")
        self.assertFalse(any(c[0] == "lp" for c in cups.calls))
        self.assertEqual(seen[-1][1]["outcome"], "send_error")

    def test_malicious_name_stays_inside_pdf(self):
        nasty = dict(LABEL)
        nasty["fields"] = dict(LABEL["fields"])
        nasty["fields"]["nombre"] = "$(reboot); rm -rf /"
        cups = Cups("ok")

        def transport(op, body):
            if op == "claim":
                return {"job": {"id": "job-prueba", "labels": [nasty]}, "attempt_id": "att-2"}
            return {"etiq": 1, "physically_printed": False, "ok": True}

        out = bridge.step(transport, "DYMO_PRUEBA", cups)
        self.assertEqual(out["lp"], 1)
        self.assertEqual(out["physically_printed"], False)
        lp = [c for c in cups.calls if c[0] == "lp"]
        self.assertEqual(len(lp), 1)
        self.assertEqual(lp[0][0], "lp")
        self.assertNotIn("reboot", " ".join(lp[0]))
        self.assertTrue(lp[0][2] == "DYMO_PRUEBA")

    def test_offline_does_not_submit(self):
        cups = Cups("offline")
        ops = []

        def transport(op, body):
            ops.append(op)
            return {"etiq": 1, "physically_printed": False}

        out = bridge.step(transport, "DYMO_PRUEBA", cups)
        self.assertEqual(out["did"], "printer_offline")
        self.assertEqual(ops, ["heartbeat"])
        self.assertFalse(any(c[0] == "lp" for c in cups.calls))

    def test_timeout_is_ambiguous_and_not_repeated(self):
        cups = Cups("timeout")
        reports = []

        def transport(op, body):
            if op == "report":
                reports.append(body)
            if op == "claim":
                return {"job": job(), "attempt_id": "att-3"}
            return {"etiq": 1, "physically_printed": False}

        out = bridge.step(transport, "DYMO_PRUEBA", cups)
        self.assertEqual(out["did"], "ambiguous")
        self.assertEqual(reports[0]["outcome"], "ambiguous")
        self.assertEqual(len([c for c in cups.calls if c[0] == "lp"]), 1)
        bridge.step(lambda op, body: {"job": None, "etiq": 1, "physically_printed": False} if op == "claim" else {"etiq": 1, "physically_printed": False}, "DYMO_PRUEBA", Cups("ok"))

    def test_clear_error_and_muddy_accept(self):
        def once(mode):
            cups = Cups(mode)
            got = {}

            def transport(op, body):
                if op == "report":
                    got.update(body)
                if op == "claim":
                    return {"job": job(), "attempt_id": "att"}
                return {"etiq": 1, "physically_printed": False}

            bridge.step(transport, "DYMO_PRUEBA", cups)
            return got, cups

        err, cups = once("error")
        self.assertEqual(err["outcome"], "send_error")
        self.assertEqual(len([c for c in cups.calls if c[0] == "lp"]), 1)
        muddy, _ = once("muddy")
        self.assertEqual(muddy["outcome"], "ambiguous")
        both, _ = once("both")
        self.assertEqual(both["outcome"], "ambiguous")
        self.assertEqual(both["cups_job_id"], "DYMO_PRUEBA-9")

    def test_size_guard(self):
        wide = dict(LABEL)
        wide["width_mm"] = 102
        wide["height_mm"] = 57
        wide["profile"] = "bodega"
        self.assertFalse(bridge.job_ok({"id": "x", "labels": [wide]}))
        self.assertTrue(bridge.job_ok(job()))

    def test_main_takes_no_argv_secrets(self):
        with self.assertRaises(SystemExit):
            bridge.main(["bridge.py", "--token", "sekreto"])

    def test_tls_stays_on_and_same_size(self):
        with open(bridge.__file__, encoding="utf-8") as handle:
            src = handle.read()
        self.assertNotIn("CERT_NONE", src)
        self.assertNotIn("check_hostname = False", src)
        ctx = bridge.https_context()
        self.assertEqual(ctx.verify_mode, __import__("ssl").CERT_REQUIRED)
        self.assertTrue(ctx.check_hostname)
        rows, pt, sw, qw, ow = bridge.place_ids("PRUEBA000261", "\u00d73", "PRUEBA-SO-001285-2")
        self.assertIn(rows, (1, 2))
        long_rows, long_pt, sw2, qw2, ow2 = bridge.place_ids("PRUEBA000261", "\u00d712", "PRUEBA-SO-001044-5-2")
        self.assertEqual(long_rows, 2)
        self.assertGreaterEqual(long_pt, 5.4)
        gap = 1.15 / 25.4 * 72.0
        maxw = (51.0 - 3.0) / 25.4 * 72.0
        self.assertLessEqual(sw2 + gap + qw2, maxw + 0.5)
        self.assertLessEqual(ow2, maxw + 0.5)

    def test_vincular_keeps_token_out_of_stdout(self):
        token = "prueba-token-123456"
        home = tempfile.mkdtemp()
        conf = os.path.join(home, "bridge.conf")
        spec = os.path.join(home, "code.json")
        with open(spec, "w", encoding="utf-8") as handle:
            handle.write('{"code":"AB23CD45EF67","queue":"DYMO_PRUEBA"}\n')
        os.chmod(spec, 0o600)
        seen = {}

        class Res(object):
            def read(self):
                return ('{"ok":true,"token":"%s","physically_printed":false,"etiq":1}' % token).encode("utf-8")

            def close(self):
                return None

        def opener(req):
            seen["url"] = req.full_url
            seen["body"] = req.data
            return Res()

        old = sys.stdout
        buf = io.StringIO()
        sys.stdout = buf
        try:
            bridge.vincular(spec, conf_path=conf, opener=opener)
        finally:
            out = buf.getvalue()
            sys.stdout = old
        self.assertNotIn(token, out)
        self.assertNotIn("AB23CD45EF67", out)
        self.assertFalse(os.path.exists(spec))
        self.assertIn("ventas-api", seen["url"])
        self.assertNotIn(token.encode("utf-8"), seen["body"])
        with open(conf, encoding="utf-8") as handle:
            body = handle.read()
        self.assertIn(token, body)
        self.assertEqual(stat.S_IMODE(os.stat(conf).st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
