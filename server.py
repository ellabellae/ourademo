#!/usr/bin/env python3
"""Tiny static file server for local preview. Serves this folder on :8137."""
import http.server
import os
import socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = 8137
with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    httpd.serve_forever()
