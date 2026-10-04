# The Supabase REST client against a local fake server: request shapes and errors.
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from supa import Supa, SupaError

SEEN = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _record(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        SEEN.append({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        return body

    def _send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self._record()
        if self.path == "/rest/v1/rpc/claim_next_card":
            return self._send(200, b"null")
        if self.path == "/rest/v1/rpc/boom":
            return self._send(400, {"message": "bad"})
        self._send(200, {"Key": "ok"})

    def do_PATCH(self):
        self._record()
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        self._record()
        if self.path.startswith("/storage/"):
            return self._send(200, b"JPEGDATA", "image/jpeg")
        self._send(200, [{"handle": "@unique_names"}])

    def do_DELETE(self):
        self._record()
        self._send(200, [])


class SupaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        SEEN.clear()

    def test_rpc_null_and_auth_headers_for_jwt_keys(self):
        s = Supa(self.base, "eyJhbGciOi.jwt.key")
        self.assertIsNone(s.rpc("claim_next_card"))
        h = SEEN[0]["headers"]
        self.assertEqual(h["apikey"], "eyJhbGciOi.jwt.key")
        self.assertEqual(h["authorization"], "Bearer eyJhbGciOi.jwt.key")

    def test_new_secret_keys_send_only_apikey(self):
        Supa(self.base, "sb_secret_abc").rpc("claim_next_card")
        self.assertNotIn("authorization", SEEN[0]["headers"])
        self.assertEqual(SEEN[0]["headers"]["apikey"], "sb_secret_abc")

    def test_update_select_upload_download_remove(self):
        s = Supa(self.base, "k")
        s.update("cards", "id=eq.1&version=eq.2", {"status": "done", "claimed_at": None})
        self.assertEqual(SEEN[-1]["method"], "PATCH")
        self.assertEqual(SEEN[-1]["path"], "/rest/v1/cards?id=eq.1&version=eq.2")
        self.assertEqual(json.loads(SEEN[-1]["body"]), {"status": "done", "claimed_at": None})
        self.assertEqual(s.select("settings", "id=eq.1&select=handle"), [{"handle": "@unique_names"}])
        s.upload("cards", "cards/abc/v1.jpg", b"\xff\xd8x")
        self.assertEqual(SEEN[-1]["path"], "/storage/v1/object/cards/cards/abc/v1.jpg")
        self.assertEqual(SEEN[-1]["headers"]["x-upsert"], "true")
        self.assertEqual(SEEN[-1]["body"], b"\xff\xd8x")
        self.assertEqual(s.download("cards", "photos/abc/v1.jpg"), b"JPEGDATA")
        self.assertEqual(SEEN[-1]["path"], "/storage/v1/object/authenticated/cards/photos/abc/v1.jpg")
        s.remove("cards", ["cards/abc/v1.jpg"])
        self.assertEqual(SEEN[-1]["method"], "DELETE")
        self.assertEqual(json.loads(SEEN[-1]["body"]), {"prefixes": ["cards/abc/v1.jpg"]})

    def test_update_returning_asks_for_the_matched_rows(self):
        Supa(self.base, "k").update("cards", "id=eq.1&version=eq.2", {"status": "done"}, returning=True)
        self.assertEqual(SEEN[-1]["path"], "/rest/v1/cards?id=eq.1&version=eq.2&select=id")
        self.assertEqual(SEEN[-1]["headers"]["prefer"], "return=representation")

    def test_http_error_and_network_error(self):
        with self.assertRaises(SupaError) as cm:
            Supa(self.base, "k").rpc("boom")
        self.assertIn("400", str(cm.exception))
        with self.assertRaises(SupaError):
            Supa("http://127.0.0.1:1", "k", timeout=2).rpc("claim_next_card")


if __name__ == "__main__":
    unittest.main()
