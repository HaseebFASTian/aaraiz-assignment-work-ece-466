"""Public projection/privacy checks; no network publication or real credentials."""

from datetime import datetime, timedelta, timezone
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from public_snapshot import project_snapshot
from publish_snapshot import PUBLISH_URL, RejectRedirects, publish, read_token, validate_url


NOW = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)
PRIVATE = "NEVER_PUBLIC_PRIVATE_SENTINEL"


def stamp(date):
    return date.isoformat().replace("+00:00", "Z")


def write(root, relative, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def source():
    return {"snapshot_utc": stamp(NOW), "monitor_checked_utc": stamp(NOW), "monitor_connected": True,
            "server": PRIVATE, "working_path": "/network/" + PRIVATE, "credentials": {"token": PRIVATE},
            "monitored_jobs": [{"id": "123456_0", "label": "caption_baseline"}],
            "job_accounting": [{"id": "123456_0", "raw_id": "654321", "label": "caption_baseline",
                                "state": "RUNNING", "elapsed": "01:20:00", "exit_code": "0:0", "host": PRIVATE}],
            "sentiment_runs": [{"name": "rnn_uni", "completed": True, "completed_epochs": 20,
                                "state": "Complete", "test_accuracy": .75, "test_examples": 5000,
                                "training_loss": .6, "secret": PRIVATE}],
            "caption_runs": [{"variant": "baseline", "name": PRIVATE, "state": "partial_epoch",
                              "completed": False, "completed_epochs": 0,
                              "result_source": "results/captioning_optimized/baseline",
                              "progress": {"epoch": 1, "completed_batches": 2, "total_batches": 2348,
                                           "seen_captions": 512, "total_captions": 591753,
                                           "online_loss": 3.0, "perplexity": math.exp(3),
                                           "elapsed_seconds": 20, "credentials": PRIVATE}}],
            "logs": [{"name": "caption_opt_123456_0.log", "updated_utc": stamp(NOW),
                      "lines": ["Batch 1/2348: loss=3.2", "token=" + PRIVATE,
                                json.dumps({"completed_batches": 2, "total_batches": 2348,
                                            "online_loss": 3.1, "password": PRIVATE})]}]}


class PublicSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        write(self.root, "work/live_progress/status.json", source())
        write(self.root, "dashboard/public/evidence.json", {
            "schema_version": 1, "updated_at_utc": stamp(NOW), "private_path": PRIVATE,
            "verification": {"tests": {"unique_count": 23, "passed_count": 23, "status": "passed"}}})

    def tearDown(self):
        self.temporary.cleanup()

    def test_allowlist_removes_private_fields_and_distinguishes_batch_metrics(self):
        result = project_snapshot(self.root, NOW)
        encoded = json.dumps(result, allow_nan=False)
        for forbidden in (PRIVATE, "/network", "123456_0", "654321", "working_path", "credentials", "raw_id"):
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(result["connected"])
        self.assertEqual(len(result["sentiment_runs"]), 5)
        self.assertEqual(len(result["caption_runs"]), 3)
        self.assertEqual(result["evidence"]["tests"]["passed_count"], 23)
        self.assertEqual(result["jobs"][0]["label"], "Baseline caption model")
        self.assertEqual([row["kind"] for row in result["batch_events"]],
                         ["batch_loss", "running_epoch_loss"])
        self.assertEqual(result["predictions"], [])

    def test_freshness_uses_both_clocks_and_does_not_fake_updates(self):
        raw = source()
        raw["snapshot_utc"] = stamp(NOW + timedelta(seconds=100))
        raw["monitor_checked_utc"] = stamp(NOW - timedelta(seconds=10))
        write(self.root, "work/live_progress/status.json", raw)
        result = project_snapshot(self.root, NOW)
        self.assertTrue(result["connected"])
        self.assertEqual(result["freshness"]["age_seconds"], 10)
        self.assertEqual(result["snapshot_utc"], raw["snapshot_utc"])
        raw["monitor_checked_utc"] = stamp(NOW - timedelta(seconds=121))
        write(self.root, "work/live_progress/status.json", raw)
        result = project_snapshot(self.root, NOW)
        self.assertTrue(result["stale"])
        self.assertFalse(result["connected"])
        raw.update(snapshot_utc=stamp(NOW), monitor_checked_utc=stamp(NOW), monitor_connected=False)
        write(self.root, "work/live_progress/status.json", raw)
        self.assertFalse(project_snapshot(self.root, NOW)["connected"])
        raw.update(snapshot_utc=stamp(NOW + timedelta(seconds=121)), monitor_connected=True)
        write(self.root, "work/live_progress/status.json", raw)
        self.assertIn("SNAPSHOT_IN_FUTURE", project_snapshot(self.root, NOW)["warnings"])

    def test_malformed_nested_data_and_huge_numbers_do_not_leak_or_crash(self):
        raw = source()
        raw.update(snapshot_utc=PRIVATE, job_accounting=[{"id": [], "label": {}, "state": PRIVATE}],
                   jobs=[{"id": {}, "label": [PRIVATE]}],
                   monitored_jobs=[{"id": "123456_0", "label": [PRIVATE]}],
                   monitor_warnings=[PRIVATE])
        raw["caption_runs"][0]["progress"].update(online_loss=10**400, perplexity=float("nan"), seen_captions=10**100)
        write(self.root, "work/live_progress/status.json", raw)
        result = project_snapshot(self.root, NOW)
        self.assertFalse(result["connected"])
        self.assertTrue(result["stale"])
        self.assertNotIn(PRIVATE, json.dumps(result, allow_nan=False))
        (self.root / "work/live_progress/status.json").write_text("{broken", encoding="utf-8")
        result = project_snapshot(self.root, NOW)
        self.assertIn("SNAPSHOT_MALFORMED", result["warnings"])
        self.assertIsNone(result["snapshot_utc"])

    def test_only_real_terminal_job_failures_are_public(self):
        raw = source()
        raw["job_accounting"][0].update(state="COMPLETED", exit_code="1:0", reason=PRIVATE)
        write(self.root, "work/live_progress/status.json", raw)
        result = project_snapshot(self.root, NOW)
        self.assertTrue(result["failure"])
        self.assertTrue(result["jobs"][0]["failed"])
        self.assertNotIn(PRIVATE, json.dumps(result))
        raw.update(job_accounting=[], jobs=[], job_failures=[], monitor_warnings=["Accounting error " + PRIVATE])
        write(self.root, "work/live_progress/status.json", raw)
        result = project_snapshot(self.root, NOW)
        self.assertFalse(result["failure"])
        self.assertIn("ACCOUNTING_UNAVAILABLE", result["warnings"])

    def test_sentiment_requires_full_test_and_epoch_evidence(self):
        metrics = {"configuration": "rnn_uni", "model_parameters": {"architecture": "RNN", "bidirectional": False,
                    "embedding_dim": 10, "source_root": PRIVATE}, "epochs": 20,
                   "training": [{"epoch": i, "loss": .5, "accuracy": .8, "examples": 45000, "seconds": 1}
                                for i in range(1, 21)],
                   "test": {"examples": 500, "correct": 375, "accuracy": .75, "loss": .4}}
        write(self.root, "results/sentiment/rnn_uni/metrics.json", metrics)
        result = project_snapshot(self.root, NOW)
        self.assertFalse(result["sentiment_runs"][0]["completed"])
        self.assertNotEqual(result["sentiment_runs"][0]["state"], "complete")
        metrics["test"].update(examples=5000, correct=3750)
        write(self.root, "results/sentiment/rnn_uni/metrics.json", metrics)
        self.assertTrue(project_snapshot(self.root, NOW)["sentiment_runs"][0]["completed"])
        metrics["test"]["correct"] = 4000
        write(self.root, "results/sentiment/rnn_uni/metrics.json", metrics)
        self.assertFalse(project_snapshot(self.root, NOW)["sentiment_runs"][0]["completed"])
        metrics["test"]["correct"] = 3750
        metrics["model_parameters"]["architecture"] = "LSTM"
        write(self.root, "results/sentiment/rnn_uni/metrics.json", metrics)
        self.assertFalse(project_snapshot(self.root, NOW)["sentiment_runs"][0]["completed"])
        (self.root / "results/sentiment/rnn_uni/metrics.json").write_text("{broken")
        self.assertFalse(project_snapshot(self.root, NOW)["sentiment_runs"][0]["completed"])

    def test_caption_requires_full_coverage_tokens_and_valid_perplexity(self):
        metrics = {"config": {"backbone": "resnet50", "cell": "lstm", "epochs": 1, "batch_size": 256, "channels_last": True},
                   "completed_epochs": 1, "training_captions": 591753,
                   "epochs": [{"epoch": 1, "train_loss": 3., "perplexity": math.exp(3), "caption_count": 500,
                               "token_count": 1500000, "batch_count": 2348, "seconds": 5000}]}
        path = "results/captioning_optimized/baseline/training_results.json"
        write(self.root, path, metrics)
        row = project_snapshot(self.root, NOW)["caption_runs"][0]
        self.assertFalse(row["completed"])
        self.assertEqual(row["completed_epochs"], 0)
        self.assertEqual(row["history"], [])
        metrics["epochs"][0]["caption_count"] = 591753
        write(self.root, path, metrics)
        self.assertTrue(project_snapshot(self.root, NOW)["caption_runs"][0]["completed"])
        metrics["config"]["epochs"] = 2
        write(self.root, path, metrics)
        row = project_snapshot(self.root, NOW)["caption_runs"][0]
        self.assertFalse(row["completed"])
        self.assertEqual(row["completed_epochs"], 1)
        self.assertEqual(len(row["history"]), 1)
        metrics["config"]["epochs"] = 1
        metrics["epochs"][0]["token_count"] = 591753
        write(self.root, path, metrics)
        row = project_snapshot(self.root, NOW)["caption_runs"][0]
        self.assertFalse(row["completed"])
        self.assertEqual(row["completed_epochs"], 0)
        self.assertEqual(row["history"], [])
        metrics["epochs"][0]["token_count"] = 1500000
        metrics["epochs"][0]["batch_count"] = 1
        write(self.root, path, metrics)
        row = project_snapshot(self.root, NOW)["caption_runs"][0]
        self.assertFalse(row["completed"])
        self.assertEqual(row["completed_epochs"], 0)
        self.assertEqual(row["history"], [])
        metrics["epochs"][0]["batch_count"] = 2348
        metrics["epochs"][0]["perplexity"] = 1
        write(self.root, path, metrics)
        row = project_snapshot(self.root, NOW)["caption_runs"][0]
        self.assertFalse(row["completed"])
        self.assertEqual(row["completed_epochs"], 0)
        self.assertEqual(row["history"], [])

    def test_publisher_target_token_redirect_and_acknowledgement(self):
        token = read_token(True, stream=io.StringIO("UNIT_TEST_TOKEN\n"))
        self.assertEqual(token, "UNIT_TEST_TOKEN")
        for url in ("http://aaraiz-assignment-work-ece-466.pages.dev/api/publish",
                    "https://aaraiz-assignment-work-ece-466.pages.dev.evil.test/api/publish",
                    PUBLISH_URL + "?token=private", "https://private@aaraiz-assignment-work-ece-466.pages.dev/api/publish"):
            with self.assertRaises(ValueError):
                validate_url(url)
        with self.assertRaises(urllib.error.HTTPError):
            RejectRedirects().redirect_request(urllib.request.Request(PUBLISH_URL), None, 302, "Found", {}, "https://evil.test")
        payload = project_snapshot(self.root, NOW)
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, maximum): return json.dumps({"ok": True, "snapshot_utc": payload["snapshot_utc"]}).encode()
        class Opener:
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return Response()
        opener = Opener()
        publish(payload, token, opener=opener)
        self.assertEqual(opener.request.full_url, PUBLISH_URL)
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer UNIT_TEST_TOKEN")
        self.assertNotIn(token.encode(), opener.request.data)
        self.assertNotIn(PRIVATE.encode(), opener.request.data)
        Response.read = lambda self, maximum: b'{"ok":true,"snapshot_utc":"wrong"}'
        with self.assertRaises(ValueError):
            publish(payload, token, opener=opener)
        with self.assertRaises(ValueError):
            publish(dict(payload, snapshot_utc=None), token, opener=opener)


if __name__ == "__main__":
    unittest.main(verbosity=2)
