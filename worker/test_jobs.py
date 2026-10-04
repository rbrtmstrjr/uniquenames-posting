# The job loop against an in-memory Supabase and a fake renderer.
import io
import os
import shutil
import tempfile
import unittest
from unittest import mock

from PIL import Image

import jobs
from render import JobError
from supa import SupaError


class FakeSupa:
    def __init__(self):
        self.jobs, self.updates, self.uploads, self.removed, self.rpcs = [], [], {}, [], []
        self.settings = [{"handle": "@unique_names", "width": 1080, "height": 1080}]
        self.fail_updates = 0

    def rpc(self, fn, args=None):
        self.rpcs.append(fn)
        if fn == "claim_next_card":
            return self.jobs.pop(0) if self.jobs else None
        return 0

    def select(self, table, query):
        return self.settings

    def update(self, table, match, values):
        if self.fail_updates:
            self.fail_updates -= 1
            raise SupaError("network down")
        self.updates.append((table, match, values))

    def upload(self, bucket, path, data, content_type="image/jpeg"):
        self.uploads[path] = data

    def download(self, bucket, path):
        return self.uploads[path]

    def remove(self, bucket, paths):
        self.removed.extend(paths)


class FakeRenderer:
    def __init__(self, ok=True, boom=None):
        self.ok, self.boom, self.composed, self.generated = ok, boom, [], 0

    def health(self):
        return {"ok": self.ok, "gpu": "Fake GPU", "error": None if self.ok else "ComfyUI is not reachable"}

    def generate_photo(self, prompt, seed, width, height):
        if self.boom:
            raise self.boom
        self.generated += 1
        return Image.new("RGB", (width, height), (90, 60, 40))

    def compose(self, photo, name, meaning, handle):
        self.composed.append((name, meaning, handle))
        return photo


def job(job_type="generate", **over):
    card = {"id": "c1", "kind": "post", "position": 3, "name": "Arlo Zenith", "meaning": "peak strength", "prompt": "p", "seed": 7,
            "version": 1, "photo_path": None, "card_path": None}
    card.update(over)
    return {"job": job_type, "card": card, "post_date": "2026-10-05", "gender_label": "Boy" if card["kind"] == "post" else None}


class JobsTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.supa = FakeSupa()
        self.r = FakeRenderer()
        self.run_ = jobs.Runner(self.supa, self.r, os.path.join(self.root, "out"), os.path.join(self.root, "cache"), log=lambda m: None)
        patcher = mock.patch("jobs.time.sleep")
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def last_card_update(self):
        return [u for u in self.supa.updates if u[0] == "cards"][-1]

    def test_no_job(self):
        self.assertFalse(self.run_.tick())
        self.assertEqual(self.supa.rpcs, ["requeue_stuck_cards", "claim_next_card"])

    def test_generate_uploads_finishes_and_backs_up(self):
        self.supa.jobs.append(job())
        self.assertTrue(self.run_.tick())
        self.assertEqual(sorted(self.supa.uploads), ["cards/c1/v1.jpg", "photos/c1/v1.jpg"])
        table, match, values = self.last_card_update()
        self.assertEqual(match, "id=eq.c1&version=eq.1")
        self.assertEqual(values["status"], "done")
        self.assertEqual(values["card_path"], "cards/c1/v1.jpg")
        self.assertEqual(values["photo_path"], "photos/c1/v1.jpg")
        self.assertIsNone(values["claimed_at"])
        self.assertTrue(os.path.exists(os.path.join(self.root, "out", "2026-10-05 Boy", "03-arlo-zenith.jpg")))
        self.assertEqual(self.r.composed, [("Arlo Zenith", "peak strength", "@unique_names")])
        self.assertIsNone(self.run_.current)

    def test_regenerate_removes_the_previous_version(self):
        self.supa.jobs.append(job(version=2, photo_path="photos/c1/v1.jpg", card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(sorted(self.supa.removed), ["cards/c1/v1.jpg", "photos/c1/v1.jpg"])
        self.assertIn("cards/c1/v2.jpg", self.supa.uploads)

    def test_restamp_reuses_the_clean_photo(self):
        buf = Image.new("RGB", (1080, 1080), (10, 10, 10))
        b = io.BytesIO()
        buf.save(b, "JPEG")
        self.supa.uploads["photos/c1/v1.jpg"] = b.getvalue()
        folder = os.path.join(self.root, "out", "2026-10-05 Boy")
        os.makedirs(folder)
        open(os.path.join(folder, "03-arlo-zenit.jpg"), "wb").write(b"old")
        self.supa.jobs.append(job("restamp", version=2, name="Arlo Zenith", photo_path="photos/c1/v1.jpg", card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(self.r.generated, 0)
        self.assertIn("cards/c1/v2.jpg", self.supa.uploads)
        self.assertEqual(self.supa.removed, ["cards/c1/v1.jpg"])
        values = self.last_card_update()[2]
        self.assertEqual(values["card_path"], "cards/c1/v2.jpg")
        self.assertNotIn("photo_path", values)
        self.assertEqual(sorted(os.listdir(folder)), ["03-arlo-zenith.jpg"])

    def test_restamp_without_photo_falls_back_to_generate(self):
        self.supa.jobs.append(job("restamp", version=2, card_path="cards/c1/v1.jpg"))
        self.run_.tick()
        self.assertEqual(self.r.generated, 1)

    def test_comfy_down_fails_with_a_friendly_reason(self):
        self.run_.renderer = FakeRenderer(ok=False)
        self.supa.jobs.append(job())
        self.run_.tick()
        values = self.last_card_update()[2]
        self.assertEqual(values["status"], "failed")
        self.assertIn("Open ComfyUI Desktop", values["error"])
        self.assertEqual(self.supa.uploads, {})

    def test_job_error_and_unexpected_error(self):
        self.run_.renderer = FakeRenderer(boom=JobError("ComfyUI did not finish within 300 seconds."))
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.last_card_update()[2]["error"], "ComfyUI did not finish within 300 seconds.")
        self.run_.renderer = FakeRenderer(boom=ValueError("bad pixels"))
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertIn("Something went wrong on your PC: bad pixels", self.last_card_update()[2]["error"])

    def test_finish_retries_through_network_blips(self):
        self.supa.fail_updates = 2
        self.supa.jobs.append(job())
        self.run_.tick()
        self.assertEqual(self.last_card_update()[2]["status"], "done")

    def test_preview_cards_are_not_backed_up(self):
        self.supa.jobs.append(job(kind="preview"))
        self.run_.tick()
        self.assertFalse(os.path.exists(os.path.join(self.root, "out")))

    def test_heartbeat(self):
        self.run_.current = "c9"
        self.run_.heartbeat_once()
        table, match, values = self.supa.updates[-1]
        self.assertEqual((table, match), ("worker_status", "id=eq.1"))
        self.assertTrue(values["comfyui_ok"])
        self.assertEqual(values["gpu"], "Fake GPU")
        self.assertEqual(values["current_card_id"], "c9")
        self.assertEqual(values["worker_version"], jobs.VERSION)


if __name__ == "__main__":
    unittest.main()
