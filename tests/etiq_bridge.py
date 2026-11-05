# -*- coding: utf-8 -*-
"""Puente con CUPS simulado y datos de prueba. No imprime y no habla con Supabase."""
import ast
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
        banned = (ast.Match, ast.NamedExpr) if hasattr(ast, "Match") else (ast.NamedExpr,)
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


if __name__ == "__main__":
    unittest.main()
