#!/usr/bin/env python3
# tests/__lib/fatal_quit_surface.py — the import surface the fatal-quit suite drives.
#
# WHY this exists: the suite exercises the REAL cms.io.service.Service and the REAL
# cms.service.workerpool.WorkerPool, but gevent, sqlalchemy and the rest of the runtime
# dependencies are not installed in the checkout the suite runs in. Every non-stdlib name
# those two modules reach for is supplied here as a placeholder, so their own source is
# loaded untouched from the real tree while the suite runs on the standard library alone.
#
# Importing this module is what applies the surface: it puts the source tree on sys.path,
# registers the placeholders, then re-exports the two real modules. The suite imports this
# before any cms module of its own.
#
# Imported by tests/test_service_fatal_quit.py. Not a suite on its own.

import os
import socket as socket_module
import sys
import threading
import types
from datetime import datetime, timedelta
from typing import NamedTuple

LIB_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(LIB_DIR))
SRC_ROOT = os.path.join(REPO_ROOT, "src")

# Generous ceiling, not a sleep: a run() that never returns must fail loudly
# instead of hanging the suite.
SERVE_FOREVER_TIMEOUT = 10


class Clock:
    """The wall clock the workerpool reads, held still so spans are exact.

    check_timeouts() reports the silence it measured in the reason it sends, so
    a clock that ticks between the shard's start time and the check would make
    that reason depend on how fast the machine is.

    """

    def __init__(self):
        self.now = datetime(2026, 1, 1)

    def before(self, seconds):
        """Return the instant this many seconds before now."""
        return self.now - timedelta(seconds=seconds)


CLOCK = Clock()


class Address(NamedTuple):
    """Mirror of cms.conf.Address, the endpoint pair the service listens on."""
    ip: str
    port: int


class ServiceCoord(NamedTuple):
    """Mirror of cms.conf.ServiceCoord, which names a service and its shard."""
    name: str
    shard: int


class ConfigError(Exception):
    """Mirror of cms.ConfigError, raised for a missing service address."""


class StreamServer:
    """Stand-in for gevent.server.StreamServer.

    The real serve_forever() blocks until stop() is called, so the shutdown is
    modelled as an action armed on the server: it runs the instant the service
    enters its main loop, which is the ordering of an RPC quit landing while the
    service is serving.

    """

    def __init__(self, address, handle=None):
        self.address = address
        self.on_serve = None
        self.stop_calls = 0
        self._is_stopped = threading.Event()

    def start(self):
        pass

    def serve_forever(self):
        if self.on_serve is not None:
            self.on_serve()
        if not self._is_stopped.wait(SERVE_FOREVER_TIMEOUT):
            raise AssertionError("serve_forever was never stopped")

    def stop(self):
        self.stop_calls += 1
        self._is_stopped.set()


def register(name, is_package=False, **attributes):
    """Install a placeholder module under name and return it.

    A registered name short-circuits the import system, so the package
    initializers of cms, cms.io and cms.service never run; only their submodules
    are loaded, from the real source tree.

    """
    module = types.ModuleType(name)
    if is_package:
        module.__path__ = [os.path.join(SRC_ROOT, *name.split("."))]
    for attribute, value in attributes.items():
        setattr(module, attribute, value)
    sys.modules[name] = module
    return module


def install_import_surface():
    """Supply every non-stdlib import the code under test performs."""
    gevent = register(
        "gevent", is_package=True,
        sleep=lambda seconds: None,
        spawn=lambda function, *args, **kwargs: None,
        spawn_later=lambda seconds, function, *args, **kwargs: None)
    gevent.event = register("gevent.event", AsyncResult=threading.Event,
                            Event=threading.Event)
    gevent.lock = register("gevent.lock", RLock=threading.RLock,
                           Semaphore=threading.Semaphore)
    gevent.socket = register("gevent.socket", socket=socket_module.socket)
    register("gevent.server", StreamServer=StreamServer)
    register("gevent.backdoor", BackdoorServer=object)

    conf = register(
        "cms.conf", Address=Address, ConfigError=ConfigError,
        ServiceCoord=ServiceCoord,
        config=types.SimpleNamespace(
            global_=types.SimpleNamespace(backdoor=False)))
    cms = register(
        "cms", is_package=True, Address=Address, ConfigError=ConfigError,
        ServiceCoord=ServiceCoord, config=conf.config,
        mkdir=lambda path: None,
        get_service_address=lambda coord: Address("127.0.0.1", 0))
    cms.conf = conf
    register("cms.util", get_service_address=cms.get_service_address)
    register("cms.log", root_logger=None, shell_handler=None,
             ServiceFilter=object, DetailedFormatter=object,
             LogServiceHandler=object, FileHandler=object)
    register("cms.db", SessionGen=object)
    register("cms.grading", is_package=True).Job = register(
        "cms.grading.Job", JobGroup=object)
    register("cmscommon", is_package=True).datetime = register(
        "cmscommon.datetime", make_datetime=lambda: CLOCK.now,
        make_timestamp=lambda value: 0.0)
    register("cms.service", is_package=True).esoperations = register(
        "cms.service.esoperations", ESOperation=object)
    register("cms.io", is_package=True)


sys.path.insert(0, SRC_ROOT)
install_import_surface()

from cms.io.service import Service  # noqa: E402
from cms.service.workerpool import REACHABILITY_HINT, WorkerPool  # noqa: E402
