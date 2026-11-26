#!/usr/bin/env python3
"""Emula iPhone + Capacitor (sin plugins) en WebKit y comprueba el visor in-page."""
import http.server, threading, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), "out")
os.makedirs(OUT, exist_ok=True)

HTML = r"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>harness iOS PDF</title></head><body>
<script>
window.Capacitor={isNativePlatform:function(){return true;},Plugins:{App:{},Network:{},StatusBar:{}}};
window.MCsbTok=function(){return Promise.resolve({ok:true,sbt:'test-token'});};
window.MC_SB_URL='/pdf_tmp_stub';
window.__assigns=[];
window.__toasts=[];
window.toast=function(m){window.__toasts.push(String(m));};
</script>
<script src="/helpers.js"></script>
<p id="ready">harness</p>
</body></html>
"""

# Extract helpers from index.html into a standalone script
src=open(os.path.join(ROOT,"index.html"),encoding="utf-8").read()

def slice_fn(start_marker, end_marker):
    a=src.index(start_marker)
    b=src.index(end_marker, a+1)
    return src[a:b]

helpers = "\n".join([
    slice_fn("function mcIsNativeApp(){", "\nfunction mcPortalCanon(){"),
    slice_fn("function mcSanitizeFilename(", "\n/* b680"),
    slice_fn("function mcClosePdfTab_(", "\nvar MC_C128="),
])
# stub location.assign after load: we'll patch in page

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/helpers.js"):
            body=helpers.encode()
            self.send_response(200)
            self.send_header("Content-Type","application/javascript; charset=utf-8")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/harness"):
            body=HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length") or 0)
        _=self.rfile.read(n)
        if self.path.startswith("/pdf_tmp_stub"):
            body=b'{"ok":true,"url":"https://bklbvwpkrdaojbezljsd.supabase.co/storage/v1/object/sign/portal-tmp/TEST/webkit.pdf?token=wk","expires_in":900}'
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

httpd=http.server.ThreadingHTTPServer(("127.0.0.1",0), H)
port=httpd.server_address[1]
th=threading.Thread(target=httpd.serve_forever, daemon=True); th.start()

IPHONE = {
  "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Capacitor/8.0.0",
  "viewport": {"width":390,"height":844,"device_scale_factor":3,"is_mobile":True,"has_touch":True},
}

ok=True
notes=[]
with sync_playwright() as p:
    browser=p.webkit.launch(headless=True)
    ctx=browser.new_context(
        user_agent=IPHONE["user_agent"],
        viewport={"width":390,"height":844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        java_script_enabled=True,
    )
    page=ctx.new_page()
    page.goto(f"http://127.0.0.1:{port}/harness", wait_until="load")
    page.evaluate("""() => {
      window.__assigns = window.__assigns || [];
      window.mcOpenSignedPdf_ = function(url){
        window.__assigns.push(String(url));
        return true;
      };
    }""")
    err=page.evaluate("""async () => {
      const blob=new Blob(['%PDF-1.4\\n%wk\\n'],{type:'application/pdf'});
      try{
        if(typeof mcIsIosNativeApp!=='function') return 'no mcIsIosNativeApp';
        if(!mcIsIosNativeApp()) return 'mcIsIosNativeApp false ua='+navigator.userAgent;
        if(mcArmPdfTab()!==null) return 'mcArmPdfTab no fue null';
        const r=await mcDownloadBlob(blob,'rutas-webkit.pdf','application/pdf',null);
        return {via:r&&r.via, opened:r&&r.opened, panel:!!document.getElementById('mc-pdf-ios'),
          back:(document.getElementById('mc-pdf-ios-back')||{}).textContent,
          open:(document.getElementById('mc-pdf-ios-open')||{}).textContent,
          toasts:window.__toasts.slice()};
      }catch(e){return 'ex:'+e.message;}
    }""")
    notes.append(("after generate", err))
    if not isinstance(err, dict) or err.get("via")!="panel" or not err.get("panel"):
        ok=False
    if isinstance(err, dict) and any("PDF listo" in str(t) for t in err.get("toasts") or []):
        ok=False
        notes.append(("false toast", err.get("toasts")))
    page.wait_for_timeout(400)
    st=page.evaluate("""() => {
      const a=document.getElementById('mc-pdf-ios-open');
      return {href:a&&a.href, text:a&&a.textContent, pointer:a&&a.style.pointerEvents, toasts:window.__toasts.slice()};
    }""")
    notes.append(("after upload", st))
    if not (st and st.get("href") and "object/sign/portal-tmp" in st.get("href")):
        ok=False
    page.screenshot(path=os.path.join(OUT,"webkit-iphone-pdf-panel.png"))
    page.locator("#mc-pdf-ios-open").click()
    after=page.evaluate("""() => ({assigns:window.__assigns.slice(), toasts:window.__toasts.slice()})""")
    notes.append(("after abrir", after))
    if not after.get("assigns") or "object/sign/portal-tmp" not in after["assigns"][0]:
        ok=False
    if not any("✓ PDF listo" in str(t) for t in after.get("toasts") or []):
        ok=False
    # click Volver should remove panel
    # restore panel if still there
    still=page.evaluate("() => !!document.getElementById('mc-pdf-ios')")
    if still:
        page.locator("#mc-pdf-ios-back").click()
        gone=page.evaluate("() => !document.getElementById('mc-pdf-ios')")
        notes.append(("volver", gone))
        if not gone: ok=False
    browser.close()

httpd.shutdown()
print("WEBKIT", "OK" if ok else "FAIL")
for n in notes:
    print("-", n[0], ":", n[1])
sys.exit(0 if ok else 1)
