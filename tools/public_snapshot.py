"""Project private monitoring evidence into a strict, public v1 allowlist.

Only this output may be published. Raw monitoring snapshots, logs and source
results must remain private. This module uses only the Python standard library.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re


SENTIMENT = {
    "rnn_uni": ("RNN · one direction", "RNN", False, 10),
    "rnn_bi": ("RNN · two directions", "RNN", True, 10),
    "lstm_uni": ("LSTM · one direction", "LSTM", False, 10),
    "lstm_bi": ("LSTM · two directions", "LSTM", True, 10),
    "lstm_bi_embedding100": ("LSTM · two directions · embedding 100", "LSTM", True, 100),
}
CAPTIONS = {
    "baseline": ("ResNet-50 + LSTM", "resnet50", "lstm"),
    "alternate_encoder": ("GoogLeNet + LSTM", "googlenet", "lstm"),
    "simple_rnn": ("ResNet-50 + RNN", "resnet50", "rnn"),
}
# Fixed seed-466 COCO test selection, verified against the preparation manifest.
COMPARISON_IMAGES = {
    49919: "90236c88f32cdce0736351b53420dea23e8cf994ce2ed985e18f7416f606335c",
    116033: "32fba6d3d9654d32cdc6fd6cee1a8374ba0e8728973317a40fd9f800e2c0c195",
    273741: "e55f3e01911c98180a7bf9907324de5f4f6c9cfcc80cc3ccc6dc38a7b44fb7e7",
    177118: "ea02d764ad5f8c9c01e0f90c14b53fd9399ea25b30e1e16e8ea50aa1e02b4c4e",
}
CAPTION_VOCABULARY_SHA256 = "ff3d26ea0127947715337a77f7f5a599ddc7e8f8f8b3fe6a0f1daff9cf25cf25"
CAPTION_ANNOTATIONS_SHA256 = "4b62086319480e0739ef390d04084515defb9c213ff13605a036061e33314317"
CAPTION_PROTOCOL = {"embed_size": 512, "hidden_size": 512, "batch_size": 256,
                    "vocab_threshold": 6, "learning_rate": 0.001, "seed": 466,
                    "max_length": 30, "freeze_backbone_stats": False}
JOB_LABELS = {"caption_baseline": "Baseline caption model", "caption_alt": "GoogLeNet caption model",
              "caption_rnn": "RNN caption model", "comparison": "Caption comparison"}
JOB_VARIANTS = {"caption_baseline": "baseline", "caption_alt": "alternate_encoder", "caption_rnn": "simple_rnn"}
FAILED = {"FAILED", "TIMEOUT", "OUT_OF_MEMORY", "OOM", "NODE_FAIL", "CANCELLED", "BOOT_FAIL",
          "DEADLINE", "PREEMPTED", "REVOKED", "SPECIAL_EXIT"}
WARNING_CODES = {"SNAPSHOT_UNAVAILABLE", "SNAPSHOT_MALFORMED", "SNAPSHOT_TIME_INVALID",
                 "SNAPSHOT_IN_FUTURE", "MONITOR_DISCONNECTED", "MONITOR_STATUS_UNKNOWN",
                 "SNAPSHOT_STALE", "SCHEDULER_UNAVAILABLE", "ACCOUNTING_UNAVAILABLE",
                 "MONITOR_WARNING", "ACTIVE_JOB_FAILED", "RESULT_MALFORMED",
                 "INVALID_DATA_DROPPED", "EVIDENCE_UNAVAILABLE", "UNMAPPED_JOB",
                 "PREDICTIONS_NOT_VERIFIED"}


def mapping(value):
    return value if isinstance(value, dict) else {}


def objects(value, maximum=100):
    return [item for item in value[:maximum] if isinstance(item, dict)] if isinstance(value, list) else []


def integer(value, maximum=10**12):
    return value if type(value) is int and 0 <= value <= maximum else None


def number(value, maximum=10**12):
    return float(value) if type(value) in (int, float) and 0 <= value <= maximum and math.isfinite(value) else None


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is None or not 2000 <= date.year <= 2100:
            return None
        return date.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except ValueError:
        return None


def read_json(path, warnings, code):
    try:
        if path.stat().st_size > 2 * 1024 * 1024:
            warnings.add(code)
            return {}
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            warnings.add(code)
            return {}
        return value
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, UnicodeError):
        warnings.add(code)
        return {}


def state(value):
    if not isinstance(value, str):
        return "unavailable"
    clean = value.strip().upper().split(" ", 1)[0].rstrip("+")
    if clean in FAILED:
        return "failed"
    return {"RUNNING": "running", "PARTIAL_EPOCH": "running", "RESUMING": "running",
            "PENDING": "queued", "QUEUED": "queued", "CONFIGURING": "preparing",
            "PREPARING": "preparing", "EPOCH_COMPLETE": "saving", "COMPLETING": "saving",
            "COMPLETE": "complete", "COMPLETED": "complete", "SAVED": "complete"}.get(clean, "unknown")


def history(rows, caption=False):
    result = []
    seen = set()
    for row in objects(rows, 100):
        epoch = integer(row.get("epoch"), 20)
        if not epoch or epoch in seen:
            continue
        seen.add(epoch)
        if caption:
            result.append({"epoch": epoch, "loss": number(row.get("train_loss"), 10000),
                           "perplexity": number(row.get("perplexity")),
                           "captions": integer(row.get("caption_count")),
                           "batches": integer(row.get("batch_count")),
                           "tokens": integer(row.get("token_count")),
                           "seconds": number(row.get("seconds"))})
        else:
            result.append({"epoch": epoch, "loss": number(row.get("loss"), 10000),
                           "accuracy": number(row.get("accuracy"), 1),
                           "seconds": number(row.get("seconds"))})
    return sorted(result, key=lambda item: item["epoch"])[:20]


def public_jobs(source, warnings):
    monitored = {row.get("id"): row.get("label") for row in objects(source.get("monitored_jobs"), 16)
                 if isinstance(row.get("id"), str)}
    rows = objects(source.get("job_accounting"), 32) + objects(source.get("job_failures"), 32)
    present = {row.get("id") for row in rows if isinstance(row.get("id"), str)}
    rows += [row for row in objects(source.get("jobs"), 32)
             if not isinstance(row.get("id"), str) or row["id"] not in present]
    result = {}
    for row in rows:
        key = row.get("label") or (monitored.get(row["id"]) if isinstance(row.get("id"), str) else None)
        label = JOB_LABELS.get(key, "Tracked task") if isinstance(key, str) else "Tracked task"
        if label == "Tracked task":
            warnings.add("UNMAPPED_JOB")
        status = state(row.get("state"))
        exit_code = row.get("exit_code")
        if not isinstance(exit_code, str) or not re.fullmatch(r"\d{1,4}:\d{1,4}", exit_code):
            exit_code = None
        bad_exit = status == "complete" and exit_code is not None and any(int(v) for v in exit_code.split(":"))
        failed = status == "failed" or bool(bad_exit)
        elapsed = row.get("elapsed")
        if not isinstance(elapsed, str) or not re.fullmatch(r"(?:\d{1,5}-)?\d{1,6}:\d{2}(?::\d{2})?", elapsed):
            elapsed = None
        clean = {"label": label, "state": "failed" if failed else status,
                 "elapsed": elapsed, "exit_code": exit_code, "failed": failed}
        if label not in result or failed:
            result[label] = clean
    return list(result.values())[:16], monitored


def batch_events(source, monitored):
    """Recent observed batches, not epoch means; no source lines or filenames leave here."""
    events = []
    for log in objects(source.get("logs"), 8):
        name = log.get("name")
        if not isinstance(name, str):
            continue
        suffix = re.search(r"_(\d+(?:_\d+)?)\.log$", name)
        job_key = monitored.get(suffix.group(1)) if suffix else None
        run_id = JOB_VARIANTS.get(job_key) if isinstance(job_key, str) else None
        if run_id is None:
            run_id = next((key for key in sorted(SENTIMENT, key=len, reverse=True)
                           if re.search(r"(?:^|_)" + re.escape(key) + r"(?:_|\.)", name)), None)
        if run_id is None:
            continue
        lines = log.get("lines")
        if not isinstance(lines, list):
            continue
        for line in lines[-12:]:
            if not isinstance(line, str) or len(line) > 4096:
                continue
            raw = {}
            match = re.fullmatch(r"Batch (\d{1,7})/(\d{1,7}): loss=([\d.eE+\-]+)", line.strip())
            if match:
                try:
                    raw = {"completed_batches": int(match[1]), "total_batches": int(match[2]),
                           "online_loss": float(match[3])}
                except ValueError:
                    continue
            elif line.lstrip().startswith("{"):
                try:
                    raw = mapping(json.loads(line))
                except (ValueError, UnicodeError):
                    continue
            batch, total = integer(raw.get("completed_batches"), 10**7), integer(raw.get("total_batches"), 10**7)
            loss = number(raw.get("online_loss"), 10000)
            if not batch or not total or batch > total or loss is None:
                continue
            events.append({"run_id": run_id, "kind": "batch_loss" if match else "running_epoch_loss",
                           "observed_at_utc": timestamp(log.get("updated_utc")),
                           "epoch": integer(raw.get("epoch")), "batch": batch, "total_batches": total,
                           "loss": loss, "accuracy": number(raw.get("online_accuracy"), 1),
                           "elapsed_seconds": number(raw.get("elapsed_seconds")),
                           "batch_seconds": number(raw.get("last_batch_seconds"))})
    unique = {json.dumps(row, sort_keys=True): row for row in events}
    return list(unique.values())[-72:]


def exact_fields(record, expected):
    """Boolean flags must not pass as integer counts, or vice versa."""
    return all(type(record.get(key)) is type(value) and record[key] == value
               for key, value in expected.items())


def reviewed_predictions(workspace, warnings, caption_runs, training_records, evidence):
    """Publish four reviewed comparisons together, or none; never repair model text."""
    prediction_path = workspace / "results/comparison/predictions.json"
    observation_path = workspace / "work/final_observations.json"
    if not prediction_path.is_file() or not observation_path.is_file():
        return []

    def require(condition):
        if not condition:
            raise ValueError("PREDICTIONS_NOT_VERIFIED")

    def read_bound(path, limit):
        with path.open("rb") as stream:
            content = stream.read(limit + 1)
        require(len(content) <= limit)
        return content

    def parse_record(content):
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result)
                result[key] = value
            return result
        result = json.loads(content, object_pairs_hook=unique_object)
        require(isinstance(result, dict))
        return result

    def text_ok(value, maximum, minimum=0):
        return (isinstance(value, str) and minimum <= len(value) <= maximum
                and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]", value))

    try:
        require(len(caption_runs) == 3 and all(row.get("completed") is True for row in caption_runs))
        prediction_bytes = read_bound(prediction_path, 256 * 1024)
        observation_bytes = read_bound(observation_path, 32 * 1024)
        prediction_hash = hashlib.sha256(prediction_bytes).hexdigest()
        observation_hash = hashlib.sha256(observation_bytes).hexdigest()
        comparison = parse_record(prediction_bytes)
        observations = parse_record(observation_bytes)
        require(exact_fields(comparison, {"seed": 466}))
        require(exact_fields(observations, {"visual_reviewed": True, "source_split": "COCO test2017",
                                           "predictions_sha256": prediction_hash}))
        marker = mapping(mapping(evidence.get("captioning")).get("comparison_review"))
        require(exact_fields(marker, {"status": "reviewed", "predictions_sha256": prediction_hash,
                                      "observations_sha256": observation_hash}))

        raw_labels = {f"{backbone}_{cell}": run_id for run_id, (_, backbone, cell) in CAPTIONS.items()}
        protocols = comparison.get("comparison_protocol")
        require(isinstance(protocols, list) and len(protocols) == 3
                and all(isinstance(row, dict) and isinstance(row.get("model"), str) for row in protocols))
        require({row["model"] for row in protocols} == set(raw_labels))
        protocol_by_label = {row["model"]: row for row in protocols}
        shared_record = None
        for label, run_id in raw_labels.items():
            training = mapping(training_records.get(run_id))
            config = mapping(training.get("config"))
            require(exact_fields(config, CAPTION_PROTOCOL))
            require(exact_fields(training, {"course_copy_verified": True, "training_images": 118287,
                    "training_captions": 591753, "vocabulary_size": 9438, "vocabulary_source": "provided_json",
                    "vocabulary_source_sha256": CAPTION_VOCABULARY_SHA256,
                    "annotations_sha256": CAPTION_ANNOTATIONS_SHA256,
                    "metric_kind": "token-weighted online training loss during the epoch"}))
            epochs = integer(training.get("completed_epochs"), 20)
            require(epochs and exact_fields(config, {"epochs": epochs}))
            epoch_rows = training.get("epochs")
            require(isinstance(epoch_rows, list) and len(epoch_rows) == epochs)
            # The projector has already checked each full epoch; retain matched
            # token/batch coverage across models as an additional protocol check.
            coverage = [(row.get("token_count"), row.get("batch_count")) for row in epoch_rows]
            shared = (epochs, coverage)
            require(shared_record is None or shared_record == shared)
            shared_record = shared
            channels_last = config.get("channels_last", False)
            require(type(channels_last) is bool)
            expected = dict(CAPTION_PROTOCOL, epoch=epochs, training_captions=591753,
                            annotations_sha256=CAPTION_ANNOTATIONS_SHA256, channels_last=channels_last,
                            cnn_memory_format="channels_last" if channels_last else "contiguous", precision="float32")
            require(exact_fields(protocol_by_label[label], expected))

        rows, notes = comparison.get("predictions"), observations.get("images")
        for records in (rows, notes):
            require(isinstance(records, list) and len(records) == 4
                    and all(isinstance(row, dict) and type(row.get("image_id")) is int for row in records))
            require({row["image_id"] for row in records} == set(COMPARISON_IMAGES))
        by_id = {row["image_id"]: row for row in rows}
        notes_by_id = {row["image_id"]: row for row in notes}
        result = []
        for image_id, image_hash in COMPARISON_IMAGES.items():
            row, note = by_id[image_id], notes_by_id[image_id]
            filename = f"{image_id:012d}.jpg"
            asset_name = f"{image_id:012d}.{image_hash}.jpg"
            require(row.get("file_name") == filename and note.get("file_name") == filename
                    and note.get("image_sha256") == image_hash)
            captions = mapping(row.get("captions"))
            require(set(captions) == set(raw_labels) and all(text_ok(value, 8192) for value in captions.values()))
            observation = note.get("observation")
            require(text_ok(observation, 2000, 20) and len(observation.strip()) >= 20
                    and not re.search(r"\b(TODO|TBD|placeholder|lorem ipsum)\b", observation, re.I))
            for path in (workspace / "results/comparison/images" / filename,
                         workspace / "dashboard/public/comparison-images" / asset_name):
                require(hashlib.sha256(read_bound(path, 8 * 1024 * 1024)).hexdigest() == image_hash)
            result.append({"image_id": image_id, "image_url": f"/comparison-images/{asset_name}",
                "image_sha256": image_hash, "predictions_sha256": prediction_hash,
                "observations_sha256": observation_hash,
                "captions": {run_id: captions[label] for label, run_id in raw_labels.items()},
                "observation": observation})
        return result
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        warnings.add("PREDICTIONS_NOT_VERIFIED")
        return []


def project_snapshot(workspace, now=None, stale_after=120):
    if type(stale_after) is not int or not 30 <= stale_after <= 3600:
        raise ValueError("INVALID_STALENESS_LIMIT")
    workspace = Path(workspace)
    now = now or datetime.now(timezone.utc)
    now = now.astimezone(timezone.utc)
    warnings = set()
    source = read_json(workspace / "work/live_progress/status.json", warnings, "SNAPSHOT_MALFORMED")
    if not source:
        warnings.add("SNAPSHOT_UNAVAILABLE")
    source_time = timestamp(source.get("snapshot_utc"))
    monitor_time = timestamp(source.get("monitor_checked_utc"))
    age, future = None, False
    if source_time:
        delta = (now - datetime.fromisoformat(source_time.replace("Z", "+00:00"))).total_seconds()
        future, age = delta < -120, max(0.0, delta)
        if future:
            warnings.add("SNAPSHOT_IN_FUTURE")
    else:
        warnings.add("SNAPSHOT_TIME_INVALID")
    if monitor_time:
        monitor_age = (now - datetime.fromisoformat(monitor_time.replace("Z", "+00:00"))).total_seconds()
        # Collector and server clocks can differ. Retain both original timestamps
        # and conservatively age evidence from the older successful observation.
        age = max(age or 0.0, max(0.0, monitor_age))
        if monitor_age < -120:
            future = True
            warnings.add("SNAPSHOT_IN_FUTURE")
    stale = source_time is None or age is None or age > stale_after or future
    if stale:
        warnings.add("SNAPSHOT_STALE")
    if source.get("monitor_connected") is False:
        warnings.add("MONITOR_DISCONNECTED")
    elif source.get("monitor_connected") is not True:
        warnings.add("MONITOR_STATUS_UNKNOWN")
    if source.get("queue_error"):
        warnings.add("SCHEDULER_UNAVAILABLE")
    if source.get("monitor_warnings"):
        warnings.add("ACCOUNTING_UNAVAILABLE")
    if source.get("read_errors"):
        warnings.add("MONITOR_WARNING")
    jobs, monitored = public_jobs(source, warnings)
    failure = any(row["failed"] for row in jobs)
    if failure:
        warnings.add("ACTIVE_JOB_FAILED")

    sentiment_source = {row.get("name"): row for row in objects(source.get("sentiment_runs"), 10)
                        if isinstance(row.get("name"), str)}
    sentiment_runs = []
    for run_id, (label, architecture, bidirectional, embedding) in SENTIMENT.items():
        row = sentiment_source.get(run_id, {})
        metrics_path = workspace / "results/sentiment" / run_id / "metrics.json"
        if not metrics_path.is_file() and run_id == "rnn_uni" and row.get("result_source") == "rnn_uni_resume":
            metrics_path = workspace / "results/sentiment/rnn_uni_resume/metrics.json"
        local_metrics_exist = metrics_path.is_file()
        metrics = read_json(metrics_path, warnings, "RESULT_MALFORMED")
        parameters = mapping(metrics.get("model_parameters"))
        valid_metrics = (metrics.get("configuration") == run_id and parameters.get("architecture") == architecture
                         and parameters.get("bidirectional") is bidirectional and parameters.get("embedding_dim") == embedding)
        if metrics and not valid_metrics:
            warnings.add("INVALID_DATA_DROPPED")
            metrics = {}
        train_history = history(metrics.get("training"))
        test = mapping(metrics.get("test"))
        accuracy = number(test.get("accuracy"), 1)
        examples = integer(test.get("examples"))
        epochs = integer(metrics.get("epochs"), 20)
        raw_history = objects(metrics.get("training"), 100)
        correct = integer(test.get("correct"), 5000)
        completed = (epochs == 20 and examples == 5000 and accuracy is not None and correct is not None
                     and math.isclose(accuracy, correct / 5000, rel_tol=0, abs_tol=1e-12)
                     and number(test.get("loss"), 10000) is not None
                     and len(train_history) == 20 and len(raw_history) == 20
                     and [item["epoch"] for item in train_history] == list(range(1, 21))
                     and all(item.get("examples") == 45000 and number(item.get("loss"), 10000) is not None
                             for item in raw_history))
        if not local_metrics_exist:
            accuracy, examples = number(row.get("test_accuracy"), 1), integer(row.get("test_examples"))
            epochs = integer(row.get("completed_epochs"), 20)
            completed = (row.get("completed") is True and epochs == 20 and accuracy is not None and examples == 5000
                         and math.isclose(accuracy * 5000, round(accuracy * 5000), rel_tol=0, abs_tol=1e-7))
        elif not completed:
            warnings.add("INVALID_DATA_DROPPED")
        current_state = "complete" if completed else state(row.get("state"))
        if not completed and current_state == "complete":
            current_state = "saving"
        sentiment_runs.append({"id": run_id, "label": label,
            "state": current_state, "completed": bool(completed),
            "completed_epochs": epochs or (train_history[-1]["epoch"] if train_history else 0), "total_epochs": 20,
            "test_accuracy": accuracy if completed else None, "test_examples": examples if completed else None,
            "training_loss": train_history[-1]["loss"] if train_history else number(row.get("training_loss"), 10000),
            "updated_at_utc": timestamp(row.get("updated_utc")),
            "config": {"architecture": architecture, "bidirectional": bidirectional, "embedding_dim": embedding,
                       "hidden_dim": 164, "classes": 2}, "history": train_history})

    caption_source = {row.get("variant"): row for row in objects(source.get("caption_runs"), 10)
                      if isinstance(row.get("variant"), str)}
    caption_runs = []
    caption_training_records = {}
    for run_id, (label, backbone, cell) in CAPTIONS.items():
        row = caption_source.get(run_id, {})
        optimized = row.get("result_source") == f"results/captioning_optimized/{run_id}"
        relative = Path("results/captioning_optimized" if optimized else "results/captioning") / run_id
        metrics = read_json(workspace / relative / "training_results.json", warnings, "RESULT_MALFORMED")
        config = mapping(metrics.get("config"))
        if metrics and (config.get("backbone") != backbone or config.get("cell") != cell):
            warnings.add("INVALID_DATA_DROPPED")
            metrics, config = {}, {}
        caption_training_records[run_id] = metrics
        saved_history = history(metrics.get("epochs"), caption=True)
        reported_epochs = integer(metrics.get("completed_epochs"), 20)
        raw_epochs = objects(metrics.get("epochs"), 100)
        planned_epochs = integer(config.get("epochs"), 20)
        batch_size = integer(config.get("batch_size"), 591753)
        train_history = []
        if (reported_epochs and planned_epochs and reported_epochs <= planned_epochs
                and metrics.get("training_captions") == 591753 and batch_size == 256):
            for item in saved_history:
                loss, perplexity = item["loss"], item["perplexity"]
                if not (item["epoch"] == len(train_history) + 1 and item["epoch"] <= reported_epochs
                        and item["captions"] == 591753 and item["tokens"] is not None and item["tokens"] >= 2 * 591753
                        and item["batches"] is not None and math.ceil(591753 / batch_size) <= item["batches"] <= 591753
                        and loss is not None and perplexity is not None and perplexity > 0
                        and math.isclose(math.log(perplexity), loss, rel_tol=1e-7, abs_tol=1e-8)):
                    warnings.add("INVALID_DATA_DROPPED")
                    break
                train_history.append(item)
        elif metrics:
            warnings.add("INVALID_DATA_DROPPED")
        completed_epochs = len(train_history)
        completed = bool(completed_epochs and completed_epochs == reported_epochs == planned_epochs
                         and len(raw_epochs) == completed_epochs and len(saved_history) == completed_epochs)
        raw_progress = mapping(row.get("progress"))
        progress = {key: integer(raw_progress.get(key)) for key in
                    ("epoch", "completed_batches", "total_batches", "seen_captions", "total_captions")}
        progress.update(loss=number(raw_progress.get("online_loss"), 10000),
                        perplexity=number(raw_progress.get("perplexity")),
                        elapsed_seconds=number(raw_progress.get("elapsed_seconds")))
        for done, total in (("completed_batches", "total_batches"), ("seen_captions", "total_captions")):
            if progress[done] is not None and progress[total] is not None and progress[done] > progress[total]:
                progress[done] = progress[total] = None
                warnings.add("INVALID_DATA_DROPPED")
        channels_last = config.get("channels_last")
        if type(channels_last) is not bool:
            channels_last = optimized if row.get("result_source") in (f"results/captioning/{run_id}", f"results/captioning_optimized/{run_id}") else None
        current_state = "complete" if completed else state(row.get("state"))
        if not completed and current_state == "complete":
            current_state = "saving"
        if not completed and any(job["failed"] and job["label"] == JOB_LABELS[key]
                                 for key, variant in JOB_VARIANTS.items() if variant == run_id for job in jobs):
            current_state = "failed"
        caption_runs.append({"id": run_id, "label": label, "state": current_state,
            "completed": completed, "completed_epochs": completed_epochs,
            "updated_at_utc": timestamp(row.get("updated_utc")),
            "config": {"backbone": backbone, "cell": cell, "precision": "float32", "channels_last": channels_last},
            "progress": progress, "history": train_history})

    evidence_path = workspace / "dashboard/public/evidence.json"
    evidence = read_json(evidence_path, warnings, "EVIDENCE_UNAVAILABLE")
    evidence_hash = None
    if evidence:
        evidence_hash = hashlib.sha256(evidence_path.read_bytes()).hexdigest()
    else:
        warnings.add("EVIDENCE_UNAVAILABLE")
    tests = mapping(mapping(evidence.get("verification")).get("tests"))
    total, passed = integer(tests.get("unique_count")), integer(tests.get("passed_count"))
    tests_status = "passed" if total and total == passed and tests.get("status") == "passed" else "pending" if total else "unavailable"
    predictions = reviewed_predictions(workspace, warnings, caption_runs, caption_training_records, evidence)
    return {"schema_version": 1, "snapshot_utc": source_time,
        "projected_utc": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "connected": source.get("monitor_connected") is True and not stale,
        "stale": stale, "failure": failure, "warnings": sorted(warnings & WARNING_CODES),
        "freshness": {"age_seconds": age, "stale_after_seconds": stale_after,
                      "monitor_checked_utc": timestamp(source.get("monitor_checked_utc"))},
        "counts": {"sentiment_completed": sum(row["completed"] for row in sentiment_runs),
                   "caption_completed": sum(row["completed"] for row in caption_runs)},
        "sentiment_runs": sentiment_runs, "caption_runs": caption_runs, "jobs": jobs,
        "batch_events": batch_events(source, monitored), "predictions": predictions,
        "evidence": {"sha256": evidence_hash, "updated_at_utc": timestamp(evidence.get("updated_at_utc")),
                     "tests": {"unique_count": total, "passed_count": passed, "status": tests_status}}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = json.dumps(project_snapshot(args.workspace), separators=(",", ":"), allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
