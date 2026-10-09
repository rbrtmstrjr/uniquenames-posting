# Tiny Supabase REST + Storage client (stdlib only). Uses the service-role key,
# which lives only in worker.env on the owner's PC.
import json
import urllib.error
import urllib.parse
import urllib.request


class SupaError(Exception):
    pass


class Supa:
    def __init__(self, url, key, timeout=30):
        self.url = url.rstrip("/")
        self.key = key
        self.timeout = timeout

    def _headers(self):
        h = {"apikey": self.key}
        # New-style secret keys (sb_secret_...) are not JWTs and must not be sent as Bearer.
        if not self.key.startswith("sb_"):
            h["Authorization"] = "Bearer " + self.key
        return h

    def _req(self, method, path, body=None, headers=None, raw=False, timeout=None):
        h = self._headers()
        data = None
        if body is not None:
            if isinstance(body, (bytes, bytearray)):
                data = bytes(body)
            else:
                data = json.dumps(body).encode("utf-8")
                h["Content-Type"] = "application/json"
        if headers:
            h.update(headers)
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                out = r.read()
        except urllib.error.HTTPError as e:
            raise SupaError("%s %s -> HTTP %d %s" % (method, path, e.code, e.read().decode("utf-8", "replace")[:300]))
        except (urllib.error.URLError, OSError) as e:
            raise SupaError("%s %s -> network error: %s" % (method, path, e))
        if raw:
            return out
        return json.loads(out) if out else None

    def rpc(self, fn, args=None):
        return self._req("POST", "/rest/v1/rpc/" + fn, args or {})

    def select(self, table, query):
        return self._req("GET", "/rest/v1/%s?%s" % (table, query))

    def update(self, table, match, values, returning=False):
        # PostgREST answers 204 even when the filter matched 0 rows. With
        # returning=True the matched rows come back, so callers can tell.
        if returning:
            return self._req("PATCH", "/rest/v1/%s?%s&select=id" % (table, match), values, {"Prefer": "return=representation"})
        return self._req("PATCH", "/rest/v1/%s?%s" % (table, match), values, {"Prefer": "return=minimal"})

    def upload(self, bucket, path, data, content_type="image/jpeg", timeout=None):
        # timeout: a reel preview (up to ~45 MB) needs longer than the default
        return self._req("POST", "/storage/v1/object/%s/%s" % (bucket, urllib.parse.quote(path)), data,
                         {"Content-Type": content_type, "x-upsert": "true"}, timeout=timeout)

    def list(self, bucket, prefix="", limit=1000, offset=0):
        """Objects directly under `prefix` (a folder): [{name, id, created_at, ...}]; sub-folders have id null."""
        return self._req("POST", "/storage/v1/object/list/%s" % bucket,
                         {"prefix": prefix, "limit": limit, "offset": offset,
                          "sortBy": {"column": "name", "order": "asc"}}) or []

    def download(self, bucket, path):
        return self._req("GET", "/storage/v1/object/authenticated/%s/%s" % (bucket, urllib.parse.quote(path)), raw=True)

    def remove(self, bucket, paths):
        return self._req("DELETE", "/storage/v1/object/%s" % bucket, {"prefixes": list(paths)})
