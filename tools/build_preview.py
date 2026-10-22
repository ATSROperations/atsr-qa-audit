"""Build a single-file preview (local mode, no server) of the app: python3 tools/build_preview.py out.html"""
import base64, re, sys, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
def rd(p): return open(os.path.join(root, p), encoding="utf-8").read()
def b64(p, mime): return "data:%s;base64,%s" % (mime, base64.b64encode(open(os.path.join(root, p), "rb").read()).decode())
html = rd("index.html")
css = rd("css/app.css")
css = re.sub(r'url\("\.\./assets/fonts/([^"]+)"\)', lambda m: 'url("%s")' % b64("assets/fonts/" + m.group(1), "font/ttf"), css)
css = css.replace('url("../assets/tick-w.png"', 'url("%s"' % b64("assets/tick-w.png", "image/png"))
html = html.replace('<link rel="stylesheet" href="css/app.css">', "<style>\n" + css + "\n</style>")
html = html.replace('href="assets/favicon.png"', 'href="%s"' % b64("assets/favicon.png", "image/png"))
html = html.replace('src="assets/logo-h.png"', 'src="%s"' % b64("assets/logo-h.png", "image/png"))
html = html.replace('src="assets/logo-h-w.png"', 'src="%s"' % b64("assets/logo-h-w.png", "image/png"))
js = "\n// ---- preview only: internal data inlined so the preview works without a server ----\n"
js += rd("functions/api/master-data.js").replace("export const", "const") + "\n"
js += rd("functions/api/college-notes.js").replace("export const", "const") + "\n"
for f in ["config", "criteria", "logo", "storage", "pdf", "theme", "app"]:
    js += "\n// ---- %s.js ----\n" % f + rd("js/%s.js" % f) + "\n"
scripts = re.search(r'  <!-- app -->\n(?:  <script src="js/[a-z]+\.js"></script>\n)+', html).group(0)
html = html.replace(scripts, "  <script>\n" + js + "  </script>\n")
open(sys.argv[1], "w", encoding="utf-8").write(html)
print(len(html))
