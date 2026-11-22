"""Prints the lines cms.log.DetailedFormatter(False) draws for the fixtures in formatter.rs.

Run from the repository root, in an environment that can import cms:

    PYTHONPATH=src TZ=UTC0 python3 backend/cms-svc/tests/log/expected.py

CMS_CONFIG must point at a config whose web_server.secret_key is not the shipped
default, since importing cms validates it. Nothing in the Rust test runs this
file: the lines are pasted into formatter.rs, and this is the record of how.

msecs is set explicitly: logging.makeLogRecord leaves the freshly built record's
own msecs in place, so a fixture that omitted it would print today's milliseconds
instead of the fixture's.
"""

import json
import logging
import os
import time

from cms.log import DetailedFormatter

FORMATTER = DetailedFormatter(False)

RECORDS = {
    "debug": {
        "msg": "worker cache warmed",
        "levelname": "DEBUG",
        "levelno": 10,
        "created": 1700000000.125,
        "filename": "worker.py",
        "funcName": "run",
        "threadName": "MainThread",
    },
    "info": {
        "msg": "contest started",
        "levelname": "INFO",
        "levelno": 20,
        "created": 1700000001.5,
        "service_name": "ContestWebServer",
        "service_shard": 0,
        "filename": "contest.py",
        "funcName": "start",
        "threadName": "MainThread",
    },
    "warning_both": {
        "msg": "submission queue is long",
        "levelname": "WARNING",
        "levelno": 30,
        "created": 1700000002.25,
        "service_name": "WorkerService",
        "service_shard": 3,
        "filename": "worker.py",
        "funcName": "run",
        "threadName": "WorkerThread-1",
    },
    "warning_name_only": {
        "msg": "peer is slow",
        "levelname": "WARNING",
        "levelno": 30,
        "created": 1700000003.75,
        "service_name": "ProxyService",
        "filename": "proxy.py",
        "funcName": "forward",
        "threadName": "MainThread",
    },
    "warning_operation": {
        "msg": "decoding submission 7",
        "levelname": "WARNING",
        "levelno": 30,
        "created": 1700000004.5,
        "service_name": "ScoringService",
        "service_shard": 1,
        "operation": "load submission",
        "filename": "score.py",
        "funcName": "score",
        "threadName": "MainThread",
    },
    "error_exception": {
        "msg": "cannot read the inbox",
        "levelname": "ERROR",
        "levelno": 40,
        "created": 1700000005.125,
        "service_name": "ResourceService",
        "service_shard": 2,
        "filename": "resource.py",
        "funcName": "check",
        "threadName": "MainThread",
        "exc_text": "Traceback (most recent call last):\n"
        "  File \"resource.py\", line 7, in check\n"
        "KeyError: 'inbox'",
    },
}


def render(name):
    record = dict(RECORDS[name])
    record.setdefault("msecs", (record["created"] - int(record["created"])) * 1000)
    return FORMATTER.format(logging.makeLogRecord(record))


lines = {name: render(name) for name in RECORDS}
print(json.dumps(lines, indent=2))

os.environ["TZ"] = "Asia/Bangkok"
time.tzset()
print(json.dumps({"info_in_bangkok": render("info")}, indent=2))
