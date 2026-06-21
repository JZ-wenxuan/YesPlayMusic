from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import ytmusicapi
import yt_dlp
from ytmurl.get import get as get_ytmrul


class handler(BaseHTTPRequestHandler):
  def do_GET(self):
    parsed_url = urlparse(self.path)
    print(ytmusicapi, '==', ytmusicapi.__version__)
    print(yt_dlp, '==', yt_dlp.version.__version__)  # type: ignore

    query = parse_qs(parsed_url.query)
    try:
      response = get_ytmrul(query['q'][0], (int(query['dmin'][0]), int(query['dmax'][0])))
    except Exception as e:
      print(e)
      body = str(e).encode('utf-8')
      self.send_response(404)
      self.send_header('Content-type', 'text/plain; charset=utf-8')
      self.send_header('Content-Length', str(len(body)))
      self.end_headers()
      self.wfile.write(body)
      return

    self.send_response(200)
    self.send_header('Content-type', 'text/plain')
    self.end_headers()
    self.wfile.write(response.encode())
