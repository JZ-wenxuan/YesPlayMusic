import http.server
from ytmurl.get import get as get_ytmrul
from urllib.parse import urlparse, parse_qs

# Create a custom request handler class
class MyRequestHandler(http.server.BaseHTTPRequestHandler):
    # Handle GET requests
    def do_GET(self):

        # parse url
        parsed_url = urlparse(self.path)
        if parsed_url.path != '/song':
            self.send_response(404)
            return


        # retrieve query
        query = parse_qs(parsed_url.query)
        try:
            response = get_ytmrul(query['q'][0], (int(query['dmin'][0]), int(query['dmax'][0])))
        except:
            self.send_response(500)
            return

        # Send the HTML message
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(response.encode())

# Create the server
server = http.server.HTTPServer(('', 8000), MyRequestHandler)

# Start the server
server.serve_forever()

