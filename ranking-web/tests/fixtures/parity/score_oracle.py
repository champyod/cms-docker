#!/usr/bin/env python3
"""Derive the expected /scores and /history values from the Python scorer.

WHY a gevent shim: the score objects reach gevent.lock.RLock transitively, and
the full gevent stack is not installable everywhere (this environment has no
pip). The running service needs all of gevent; this oracle needs one lock, so it
installs the smallest honest substitute and imports the real Scoring module.

Usage: python3 score_oracle.py seed.json
"""

import importlib
import json
import sys
import threading
import types
from pathlib import Path


def install_gevent_shim() -> None:
    gevent = types.ModuleType("gevent")
    lock = types.ModuleType("gevent.lock")
    lock.RLock = threading.RLock
    gevent.lock = lock
    sys.modules["gevent"] = gevent
    sys.modules["gevent.lock"] = lock


class FakeStore:
    """Stands in for a Store: the scorer only reads the backing dict and
    subscribes to callbacks it does not need when loading a static fixture."""

    def __init__(self, backing: dict) -> None:
        self._store = backing

    def add_create_callback(self, *args, **kwargs) -> None:
        return None

    add_update_callback = add_create_callback
    add_delete_callback = add_create_callback

    def retrieve(self, key: str) -> dict:
        return self._store[key].get()


def build(spec, repo_src: Path):
    sys.path.insert(0, str(repo_src))
    scoring = importlib.import_module("cmsranking.Scoring")
    entity = importlib.import_module("cmsranking.Entity")
    submission_module = importlib.import_module("cmsranking.Submission")
    subchange_module = importlib.import_module("cmsranking.Subchange")
    task_module = importlib.import_module("cmsranking.Task")

    def entity_of(module, name: str, payload: dict):
        item = module.__dict__[name]()
        item.key = payload["key"]
        item.set(payload["data"])
        return item

    tasks = {}
    for key, data in spec["entities"]["tasks"].items():
        tasks[key] = entity_of(task_module, "Task", {"key": key, "data": data})
    submissions = {}
    for key, data in spec["entities"]["submissions"].items():
        submissions[key] = entity_of(submission_module, "Submission", {"key": key, "data": data})
    subchanges = {}
    for key, data in spec["entities"]["subchanges"].items():
        subchanges[key] = entity_of(subchange_module, "Subchange", {"key": key, "data": data})

    stores = {
        "task": FakeStore(tasks),
        "submission": FakeStore(submissions),
        "subchange": FakeStore(subchanges),
    }
    store = scoring.ScoringStore(stores)
    store.init_store()
    return store


def scores_payload(store) -> dict:
    result: dict = {}
    for user, per_task in store._scores.items():
        for task, score in per_task.items():
            value = score.get_score()
            if value > 0.0:
                result.setdefault(user, {})[task] = value
    return result


def main() -> int:
    install_gevent_shim()
    seed_path = Path(sys.argv[1])
    repo_src = Path(__file__).resolve().parents[5] / "src"
    store = build(json.loads(seed_path.read_text(encoding="utf-8")), repo_src)
    print(json.dumps({
        "scores": scores_payload(store),
        "history": [list(entry) for entry in store.get_global_history()],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
