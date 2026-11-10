"""Publish only the sanitized public snapshot; never print or store credentials.

python dashboard/tools/publish_snapshot.py --token-stdin
Or supply DASHBOARD_PUBLISH_TOKEN in this process's environment. Default poll:30s.
--serve provides sanitized local GET /api/status on 127.0.0.1:8765 for UI QA.
"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from public_snapshot import project_snapshot


PUBLISH_URL = "https://aaraiz-assignment-work-ece-466.pages.dev/api/publish"


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise urllib.error.HTTPError(request.full_url, code, "Redirects disabled", headers, None)


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "aaraiz-assignment-work-ece-466.pages.dev"
            or parsed.port not in (None, 443) or parsed.path != "/api/publish"
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment):
        raise ValueError("PUBLISH_TARGET_REJECTED")
    return url


def read_token(use_stdin=False, environment=None, stream=None):
    environment = os.environ if environment is None else environment
    stream = sys.stdin if stream is None else stream
    token = stream.readline(4097).strip() if use_stdin else environment.get("DASHBOARD_PUBLISH_TOKEN", "").strip()
    if not token or len(token) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in token):
        raise ValueError("PUBLISH_TOKEN_UNAVAILABLE_OR_INVALID")
    return token


def publish(payload, token, url=PUBLISH_URL, opener=None):
    validate_url(url)
    if payload.get("snapshot_utc") is None:
        raise ValueError("SOURCE_SNAPSHOT_UNAVAILABLE")
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(body) > 256 * 1024:
        raise ValueError("PUBLIC_PAYLOAD_TOO_LARGE")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json",
        "Accept": "application/json", "User-Agent": "AssignmentProgressPublisher/1"})
    opener = opener or urllib.request.build_opener(RejectRedirects())
    with opener.open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError("PUBLISH_NOT_ACCEPTED")
        acknowledgement = response.read(4097)
        if len(acknowledgement) > 4096:
            raise ValueError("PUBLISH_ACKNOWLEDGEMENT_INVALID")
        acknowledgement = json.loads(acknowledgement)
        if (not isinstance(acknowledgement, dict) or acknowledgement.get("ok") is not True
                or acknowledgement.get("snapshot_utc") != payload["snapshot_utc"]):
            raise ValueError("PUBLISH_ACKNOWLEDGEMENT_INVALID")


def serve(workspace, port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # URLs/query strings must not become an accidental log channel.

        def do_GET(self):
            if self.path not in ("/api/status", "/status.json"):
                self.send_error(404, "Not found")
                return
            body = json.dumps(project_snapshot(workspace), allow_nan=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    print(json.dumps({"event": "sanitized_preview_ready", "port": port}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--token-stdin", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=30)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.serve:
        serve(args.workspace, args.port)
        return 0
    if args.interval < 10:
        print(json.dumps({"event": "configuration_error", "code": "INTERVAL_TOO_SHORT"}), flush=True)
        return 1
    try:
        token = read_token(args.token_stdin)
    except ValueError:
        print(json.dumps({"event": "configuration_error", "code": "TOKEN_UNAVAILABLE"}), flush=True)
        return 1
    while True:
        succeeded = False
        try:
            payload = project_snapshot(args.workspace)
            publish(payload, token)
            print(json.dumps({"event": "published", "snapshot_utc": payload["snapshot_utc"],
                              "connected": payload["connected"]}), flush=True)
            succeeded = True
        except urllib.error.HTTPError as error:
            print(json.dumps({"event": "publish_failed", "code": "HTTP_ERROR", "status": error.code}), flush=True)
        except (OSError, ValueError, urllib.error.URLError):
            print(json.dumps({"event": "publish_failed", "code": "PUBLICATION_UNAVAILABLE"}), flush=True)
        if args.once:
            return 0 if succeeded else 1
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(json.dumps({"event": "publisher_stopped"}), flush=True)
