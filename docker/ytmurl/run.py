from http.server import HTTPServer

from api.ytmurl import handler

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('0.0.0.0', port), handler)
    print(f'ytmurl server running at http://0.0.0.0:{port}')
    server.serve_forever()
