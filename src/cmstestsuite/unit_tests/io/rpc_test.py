#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2014-2017 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2015 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2019 Edoardo Morassutto <edoardo.morassutto@gmail.com>
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

"""Tests for RPC system.

"""

import socket
import unittest
from unittest.mock import Mock, patch

import gevent
import gevent.event
import gevent.socket
from gevent.server import StreamServer

from cms import Address, ServiceCoord
from cms.io import RPCError, rpc_method, RemoteServiceServer, \
    RemoteServiceClient


class MockService:
    def not_rpc_callable(self):
        pass

    @rpc_method
    def raise_exception(self):
        raise RuntimeError()

    @rpc_method
    def return_unencodable(self):
        return RuntimeError()

    @rpc_method
    def echo(self, value):
        return value

    @rpc_method
    def echo_slow(self, value):
        gevent.sleep(0.01)
        return value

    @rpc_method
    def infinite(self):
        event = gevent.event.Event()
        event.wait()


class TestRPC(unittest.TestCase):

    def setUp(self):
        patcher = patch("cms.io.rpc.get_service_address")
        self.mock = patcher.start()
        self.addCleanup(patcher.stop)

        self.service = MockService()
        self.servers = list()
        self.clients = list()
        self.spawn_listener()

    def spawn_listener(self, host: str = "127.0.0.1", port: int = 0):
        """Start listening on the given host and port.

        Each incoming connection will cause a RemoteServiceServer to be
        instantiated (and therefore a greenlet to be spawned) and to be
        inserted in self.servers. The listening host and port will also
        be stored as self.host and self.port.

        host: the hostname or IP address
        port: the port (0 causes any available port to be chosen)

        """
        self._server = StreamServer((host, port), self.handle_new_connection)
        self._server.start()
        self.host = self._server.server_host
        self.port = self._server.server_port
        self.mock.return_value = Address(self.host, self.port)

    def kill_listener(self):
        """Stop listening."""
        # Some code may kill the listener in the middle of a test, and
        # plan to spawn a new one afterwards. Yet if the test fails
        # then upon tearDown _server will still be unset.
        if hasattr(self, "_server"):
            self._server.stop()
            del self._server
        # We leave self.host and self.port.

    def handle_new_connection(self, socket_: socket.socket, address: tuple[str, int]):
        """Create a new RemoteServiceServer to handle a new connection.

        Instantiate a RemoteServiceServer, add it to self.servers and
        have it listen on the given socket (which is for a connection
        opened by a remote host from the given address). This method
        will block until the socket gets closed.

        socket_: the socket to use
        address: the (ip address, port) of the remote part

        """
        server = RemoteServiceServer(self.service, address)
        self.servers.append(server)
        server.handle(socket_)

    def get_client(
        self, coord: ServiceCoord, block: bool = True, auto_retry: float | None = None
    ) -> RemoteServiceClient:
        """Obtain a new RemoteServiceClient to connect to a server.

        Instantiate a RemoteServiceClient, spawn its greenlet and add
        it to self.clients. It will try to connect to the service at
        the given coordinates.

        coord: the (name, shard) of the service
        block: whether to wait for the connection to be
            established before returning
        auto_retry: how long to wait after a disconnection
            before trying to reconnect
        return: a client

        """
        client = RemoteServiceClient(coord, auto_retry)
        client.connect()
        if block:
            client._connection_event.wait()
        self.clients.append(client)
        return client

    def disconnect_servers(self):
        """Disconnect all registered servers from their clients."""
        servers = self.servers.copy()
        for server in servers:
            if server.connected:
                server.disconnect()

    def disconnect_clients(self):
        """Disconnect all registered clients from their servers."""
        clients = self.clients.copy()
        for client in clients:
            if client.connected:
                client.disconnect()

    @staticmethod
    def sleep():
        """Pause the greenlet so other work can be done."""
        gevent.sleep(0.005)

    def tearDown(self):
        self.kill_listener()
        self.disconnect_clients()
        self.disconnect_servers()
        self.sleep()

    def test_it_returns_an_error_for_an_unknown_method(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.not_existent()
        result.wait()
        self.assertFalse(result.successful())
        self.assertIsInstance(result.exception, RPCError)

    def test_it_returns_an_error_for_a_method_that_is_not_rpc_callable(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.not_rpc_callable()
        result.wait()
        self.assertFalse(result.successful())
        self.assertIsInstance(result.exception, RPCError)

    def test_it_returns_an_error_when_the_method_raises(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.raise_exception()
        result.wait()
        self.assertFalse(result.successful())
        self.assertIsInstance(result.exception, RPCError)

    def test_it_returns_an_error_when_the_argument_is_unencodable(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.echo(value=RuntimeError())
        result.wait()
        self.assertFalse(result.successful())
        self.assertIsInstance(result.exception, RPCError)

    def test_it_never_resolves_when_the_result_is_unencodable(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.return_unencodable()
        result.wait(timeout=0.002)
        self.assertFalse(result.ready())

    def test_it_returns_a_boolean_result(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.echo(value=True)
        result.wait()
        self.assertTrue(result.successful())
        self.assertIs(result.value, True)

    def test_it_returns_an_integer_result(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.echo(value=42)
        result.wait()
        self.assertTrue(result.successful())
        self.assertEqual(result.value, 42)

    def test_it_returns_a_string_result(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.echo(value="Hello World")
        result.wait()
        self.assertTrue(result.successful())
        self.assertEqual(result.value, "Hello World")

    def test_it_returns_a_list_result(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result = client.echo(value=["Hello", 42, "World"])
        result.wait()
        self.assertTrue(result.successful())
        self.assertEqual(result.value, ["Hello", 42, "World"])

    @patch("cms.io.rpc.gevent.socket.socket")
    @patch("cms.io.rpc.gevent.socket.getaddrinfo")
    def test_it_connects_without_blocking(self, getaddrinfo_mock, socket_mock):
        # Calling getaddrinfo breaks the mocking of the socket, so it is mocked
        # as well. It returns the addresses associated with the service, in
        # this case just one.
        getaddrinfo_mock.return_value = [
            (gevent.socket.AF_INET, gevent.socket.SOCK_STREAM, 6, "",
                (self.host, self.port))]
        # Patch the connect method of sockets so that it blocks until
        # we set the done_event (we will do so at the end of the test).
        connect_mock = socket_mock.return_value.connect
        done_event = gevent.event.Event()
        connect_mock.side_effect = lambda _: done_event.wait()
        # Connect to the RPC server in non-blocking mode and make sure
        # that we indeed don't block (i.e., take more than 0.001s).
        with gevent.Timeout(0.001) as timeout:
            try:
                client = self.get_client(ServiceCoord("Foo", 0), block=False)
            except gevent.Timeout as t:
                if t is not timeout:
                    raise
                self.fail("Connecting blocks")
        # As socket.connect() never returned, the RPC client cannot have
        # connected.
        self.assertFalse(client.connected)
        # Unblock the socket's connect method and make sure it actually
        # got called (otherwise this whole tests is pointless). Also,
        # yield to other greenlets so that they can be awoken after the
        # event triggered.
        done_event.set()
        gevent.sleep()
        getaddrinfo_mock.assert_called_once_with(self.host, self.port,
                                                 type=socket.SOCK_STREAM)
        connect_mock.assert_called_once_with((self.host, self.port))

    def test_it_reconnects_after_the_server_disconnects(self):
        client = self.get_client(ServiceCoord("Foo", 0), auto_retry=0.002)
        self.sleep()
        self.assertTrue(client.connected)
        self.disconnect_servers()
        gevent.sleep(0.1)
        self.assertTrue(client.connected,
                        "Autoreconnect didn't kick in "
                        "after server disconnected")

    def test_it_reconnects_only_after_the_server_returns(self):
        client = self.get_client(ServiceCoord("Foo", 0), auto_retry=0.002)
        self.sleep()
        self.assertTrue(client.connected)
        self.disconnect_servers()
        self.kill_listener()
        self.sleep()
        self.assertFalse(client.connected)
        self.spawn_listener(port=self.port)
        self.sleep()
        self.assertTrue(client.connected, "Autoreconnect didn't kick in "
                                          "after server came back online")

    def test_it_does_not_reconnect_after_an_explicit_disconnect(self):
        client = self.get_client(ServiceCoord("Foo", 0), auto_retry=0.002)
        self.sleep()
        self.assertTrue(client.connected)
        self.disconnect_clients()
        self.sleep()
        self.assertFalse(client.connected, "Autoreconnect still active "
                                           "after explicit disconnection")

    def test_a_slow_call_does_not_block_a_concurrent_call(self):
        client = self.get_client(ServiceCoord("Foo", 0))
        result1 = client.infinite()
        self.sleep()
        result2 = client.echo(value=True)
        self.sleep()
        self.assertTrue(result2.successful())
        self.assertIs(result2.value, True)
        self.assertFalse(result1.ready())
        self.disconnect_clients()
        self.assertTrue(result1.ready())
        self.assertFalse(result1.successful())
        self.assertIsInstance(result1.exception, RPCError)

    def test_it_calls_the_connect_and_disconnect_handlers(self):
        coord = ServiceCoord("Foo", 0)
        client = self.get_client(coord)
        self.sleep()
        client.disconnect()
        on_connect_handler = Mock()
        client.add_on_connect_handler(on_connect_handler)
        on_disconnect_handler = Mock()
        client.add_on_disconnect_handler(on_disconnect_handler)

        client.connect()
        self.sleep()
        self.assertTrue(client.connected)
        on_connect_handler.assert_called_once_with(coord)
        on_connect_handler.reset_mock()
        self.assertFalse(on_disconnect_handler.called)

        client.disconnect()
        self.sleep()
        self.assertFalse(client.connected)
        self.assertFalse(on_connect_handler.called)
        on_disconnect_handler.assert_called_once_with()
        on_disconnect_handler.reset_mock()

        client.connect()
        self.sleep()
        self.assertTrue(client.connected)
        on_connect_handler.assert_called_once_with(coord)
        on_connect_handler.reset_mock()
        self.assertFalse(on_disconnect_handler.called)

        self.disconnect_servers()
        gevent.sleep(0.1)
        self.assertFalse(client.connected)
        self.assertFalse(on_connect_handler.called)
        on_disconnect_handler.assert_called_once_with()
        on_disconnect_handler.reset_mock()

    def test_it_can_reconnect_repeatedly(self):
        client = self.get_client(ServiceCoord("Foo", 0))

        on_connect_handler = Mock()
        client.add_on_connect_handler(on_connect_handler)
        on_disconnect_handler = Mock()
        client.add_on_disconnect_handler(on_disconnect_handler)

        for i in range(10):
            self.assertTrue(client.connected)
            result = client.echo(value=42)
            result.wait()
            self.assertTrue(result.successful())
            self.assertEqual(result.value, 42)
            self.assertTrue(client.connected)

            self.sleep()
            client.disconnect()
            self.assertFalse(client.connected)
            self.sleep()
            client.connect()
            client._connection_event.wait()
            self.assertTrue(client.connected)

        self.sleep()

        self.assertEqual(on_connect_handler.call_count, 10)
        self.assertEqual(on_disconnect_handler.call_count, 10)

    def test_connecting_an_already_connected_client_raises(self):
        # Check that asking an already-connected client to connect
        # again causes an error.
        client = self.get_client(ServiceCoord("Foo", 0))
        self.assertRaises(Exception, client.connect)

    def test_initializing_an_already_connected_server_raises(self):
        # Check that asking an already-connected server to initialize
        # again its connection causes an error.
        self.get_client(ServiceCoord("Foo", 0))
        self.sleep()
        self.assertRaises(Exception, self.servers[0].initialize, "foo")

    def test_disconnecting_a_client_is_idempotent(self):
        # Check that asking a non-connected client to disconnect is
        # harmless (i.e. disconnection is idempotent).
        client = self.get_client(ServiceCoord("Foo", 0))
        client.disconnect()
        self.sleep()
        client.disconnect()
        self.sleep()

    def test_disconnecting_a_server_is_idempotent(self):
        # Check that asking a non-connected server to disconnect is
        # harmless (i.e. disconnection is idempotent).
        self.get_client(ServiceCoord("Foo", 0))
        self.sleep()
        self.servers[0].disconnect()
        self.sleep()
        self.servers[0].disconnect()
        self.sleep()

    def test_it_closes_the_connection_on_malformed_json(self):
        sock = gevent.socket.create_connection((self.host, self.port))
        sock.sendall(b"foo\r\n")
        self.sleep()
        # Malformed messages cause the connection to be closed.
        self.assertFalse(self.servers[0].connected)
        sock.close()

    def test_it_closes_the_connection_on_incomplete_json(self):
        sock = gevent.socket.create_connection((self.host, self.port))
        sock.sendall(b'{"__id": "foo"}\r\n')
        self.sleep()
        # Malformed messages cause the connection to be closed.
        self.assertFalse(self.servers[0].connected)
        sock.close()


if __name__ == "__main__":
    unittest.main()
