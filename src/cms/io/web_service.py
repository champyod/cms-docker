#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2013 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2015 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2013-2016 Luca Wehrstedt <luca.wehrstedt@gmail.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import logging
from io import BytesIO
from typing import Callable, Dict, Any, List, Optional

import tornado.web
import tornado.httputil
import tornado.log
from gevent.pywsgi import WSGIServer
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.middleware.shared_data import SharedDataMiddleware

from cms.db.filecacher import FileCacher
from cms.server.file_middleware import FileServerMiddleware
from .service import Service
from .web_rpc import RPCMiddleware


logger = logging.getLogger(__name__)


SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60


class _WSGIConnection(tornado.httputil.HTTPConnection):
    """Mock HTTP connection used to capture a tornado handler's response.

    This is part of the WSGIApplication WSGI adapter.  It buffers the
    response status, headers and body so that WSGIApplication can
    return them to the WSGI server in the expected format.
    """

    def __init__(self, method: str) -> None:
        self.method = method
        self._status: Optional[str] = None
        self._response_headers: Optional[List[tuple]] = None
        self._write_buffer: List[bytes] = []

    # Required by RequestHandler.finish()
    def set_close_callback(self, callback: Optional[Callable]) -> None:
        pass

    def write_headers(
        self,
        start_line: tornado.httputil.ResponseStartLine,
        headers: tornado.httputil.HTTPHeaders,
        chunk: Optional[bytes] = None,
    ) -> None:
        self._status = "%d %s" % (start_line.code, start_line.reason)
        self._response_headers = list(headers.get_all())
        if chunk:
            self._write_buffer.append(chunk)
        return None  # type: ignore[return-value]

    def write(self, chunk: bytes) -> None:
        self._write_buffer.append(chunk)
        return None  # type: ignore[return-value]

    def finish(self) -> None:
        pass


class WSGIApplication(tornado.web.Application):
    """WSGI-compatible wrapper for tornado.web.Application.

    This replaces tornado.wsgi.WSGIApplication which was removed in
    tornado 6.0.  It provides a synchronous WSGI interface suitable for
    use with gevent-based WSGI servers.

    Request handlers must be synchronous (no async def / yield).
    """

    def __call__(
        self,
        environ: Dict[str, Any],
        start_response: Callable,
    ) -> List[bytes]:
        """Handle a WSGI request synchronously."""
        # Tornado routing expects just path + query string, not the full URL
        uri = environ.get("PATH_INFO", "/")
        query_string = environ.get("QUERY_STRING", "")
        if query_string:
            uri += "?" + query_string

        # Build HTTP headers from WSGI environ
        headers = tornado.httputil.HTTPHeaders()
        content_type = environ.get("CONTENT_TYPE", "")
        if content_type:
            headers["Content-Type"] = content_type
        content_length = environ.get("CONTENT_LENGTH", "")
        if content_length:
            headers["Content-Length"] = content_length
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                header_name = key[5:].replace("_", "-").title()
                headers.add(header_name, value)

        # Read request body
        body = environ.get("wsgi.input", BytesIO()).read()

        # Create a mock connection with a context carrying remote_ip/protocol
        connection = _WSGIConnection(environ["REQUEST_METHOD"])
        connection.context = type(  # type: ignore[attr-defined]
            "_WSGIContext",
            (),
            {
                "remote_ip": environ.get("REMOTE_ADDR", ""),
                "protocol": environ.get("wsgi.url_scheme", "http"),
            },
        )()

        # Build the tornado request object
        request = tornado.httputil.HTTPServerRequest(
            method=environ["REQUEST_METHOD"],
            uri=uri,
            version="HTTP/1.1",
            headers=headers,
            body=body,
            connection=connection,
        )

        # Find the handler and execute it synchronously
        delegate = self.find_handler(request)
        handler = delegate.handler_class(
            self, request, **delegate.handler_kwargs
        )
        transforms = [t(request) for t in self.transforms]
        self._execute_sync(
            handler, transforms, delegate.path_args, delegate.path_kwargs
        )

        start_response(
            connection._status or "500 Internal Server Error",
            connection._response_headers or [],
        )
        return connection._write_buffer

    def _execute_sync(
        self,
        handler: tornado.web.RequestHandler,
        transforms: list,
        path_args: list,
        path_kwargs: dict,
    ) -> None:
        """Execute a synchronous tornado handler, mirroring _execute."""
        handler._transforms = transforms
        try:
            if handler.request.method not in handler.SUPPORTED_METHODS:
                raise tornado.web.HTTPError(405)

            handler.request._parse_body()

            handler.path_args = [
                handler.decode_argument(arg) for arg in path_args
            ]
            handler.path_kwargs = {
                k: handler.decode_argument(v, name=k)
                for k, v in path_kwargs.items()
            }

            if (
                handler.request.method not in ("GET", "HEAD", "OPTIONS")
                and self.settings.get("xsrf_cookies")
            ):
                handler.check_xsrf_cookie()

            handler.prepare()

            if handler._finished:
                return

            method = getattr(handler, handler.request.method.lower())
            method(*handler.path_args, **handler.path_kwargs)

            if handler._auto_finish and not handler._finished:
                handler.finish()
        except Exception as e:
            try:
                handler._handle_request_exception(e)
            except Exception:
                tornado.log.app_log.error(
                    "Exception in exception handler", exc_info=True
                )


class WebService(Service):
    """RPC service with Web server capabilities.

    """

    def __init__(
        self,
        listen_port: int,
        handlers: list,
        parameters: dict,
        shard: int = 0,
        listen_address: str = "",
    ):
        super().__init__(shard)

        static_files = parameters.pop('static_files', [])
        rpc_enabled = parameters.pop('rpc_enabled', False)
        rpc_auth = parameters.pop('rpc_auth', None)
        auth_middleware = parameters.pop('auth_middleware', None)
        num_proxies_used = parameters.pop('num_proxies_used', None)

        self.wsgi_app = WSGIApplication(handlers, **parameters)
        self.wsgi_app.service = self

        for entry in static_files:
            # TODO If we will introduce a flag to trigger autoreload in
            # Jinja2 templates, use it to disable the cache arg here.
            self.wsgi_app = SharedDataMiddleware(
                self.wsgi_app, {"/static": entry},
                cache=True, cache_timeout=SECONDS_IN_A_YEAR,
                fallback_mimetype="application/octet-stream")

        self.file_cacher = FileCacher(self)
        self.wsgi_app = FileServerMiddleware(self.file_cacher, self.wsgi_app)

        if rpc_enabled:
            self.wsgi_app = DispatcherMiddleware(
                self.wsgi_app, {"/rpc": RPCMiddleware(self, rpc_auth)})

        # The authentication middleware needs to be applied before the
        # ProxyFix as otherwise the remote address it gets is the one
        # of the proxy.
        if auth_middleware is not None:
            self.wsgi_app = auth_middleware(self.wsgi_app)
            self.auth_handler = self.wsgi_app

        # If we are behind one or more proxies, we'll use the content
        # of the X-Forwarded-For HTTP header (if provided) to determine
        # the client IP address, ignoring the one the request came from.
        # This allows to use the IP lock behind a proxy. Activate it
        # only if all requests come from a trusted source (if clients
        # were allowed to directlty communicate with the server they
        # could fake their IP and compromise the security of IP lock).
        if num_proxies_used is None:
            num_proxies_used = 0

        if num_proxies_used > 0:
            self.wsgi_app = ProxyFix(self.wsgi_app, x_for=num_proxies_used)

        self.web_server = WSGIServer((listen_address, listen_port), self)

    def __call__(self, environ, start_response):
        """Execute this instance as a WSGI application.

        See the PEP for the meaning of parameters. The separation of
        __call__ and wsgi_app eases the insertion of middlewares.

        """
        return self.wsgi_app(environ, start_response)

    def run(self):
        """Start the WebService.

        Both the WSGI server and the RPC server are started.

        """
        self.web_server.start()
        Service.run(self)
        self.web_server.stop()
