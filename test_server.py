from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
ROOT = Path('/tmp/nexos_dual/public')
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split('?',1)[0] in ('/enterprise','/enterprise/','/redesign','/redesign/'):
            return str(ROOT / 'index-redesign.html')
        return super().translate_path(path)
httpd=ThreadingHTTPServer(('127.0.0.1',4010), partial(Handler, directory=str(ROOT)))
print('serving', flush=True)
httpd.serve_forever()
