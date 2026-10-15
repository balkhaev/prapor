import base64
import contextlib
import os
from pathlib import Path
import socket
import stat
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

import proxy

TOKEN = b"0123456789abcdef" * 4
REQUEST = b"CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n"


def receive_header(client):
    data = bytearray()
    while b"\r\n\r\n" not in data:
        block = client.recv(4096)
        if not block:
            raise AssertionError("connection closed before response")
        data.extend(block)
    end = data.index(b"\r\n\r\n") + 4
    return bytes(data[:end]), bytes(data[end:])


def receive_all(client):
    result = bytearray()
    while True:
        block = client.recv(65536)
        if not block:
            return bytes(result)
        result.extend(block)


def wait_for(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.005)
    raise AssertionError("condition timed out")


class Upstream:
    def __init__(self, handler):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.listener.settimeout(.05)
        self.port = self.listener.getsockname()[1]
        self.handler = handler
        self.stopping = threading.Event()
        self.accepted = 0
        self.workers = []
        self.errors = []
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        while not self.stopping.is_set():
            try:
                connection, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self.accepted += 1

            def handle(client):
                with client:
                    client.settimeout(5)
                    try:
                        self.handler(client)
                    except OSError:
                        pass  # Intentional timeout/disconnect tests close peers.
                    except Exception as error:
                        self.errors.append(error)

            worker = threading.Thread(target=handle, args=(connection,), daemon=True)
            self.workers.append(worker)
            worker.start()

    def close(self):
        self.stopping.set()
        self.listener.close()
        self.thread.join(1)
        for worker in self.workers:
            worker.join(1)
        if self.errors:
            raise self.errors[0]


class RunningRelay:
    def __init__(self, upstream_port, limits=proxy.Limits()):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        self.port = listener.getsockname()[1]
        self.relay = proxy.Relay([listener], TOKEN, upstream_port, limits)
        self.errors = []

        def run():
            try:
                self.relay.run(log=False)
            except Exception as error:
                self.errors.append(error)

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def connect(self, source=None):
        client = socket.socket()
        client.settimeout(3)
        if source:
            client.bind((source, 0))
        client.connect(("127.0.0.1", self.port))
        return client

    def close(self):
        self.relay.stop()
        self.thread.join(2)
        if self.thread.is_alive():
            raise AssertionError("relay did not stop")
        if self.errors:
            raise self.errors[0]
        if self.relay.connections or self.relay.listeners:
            raise AssertionError("relay did not close descriptors")


def echo(connection):
    while True:
        data = connection.recv(16384)
        if not data:
            return
        connection.sendall(data)


@contextlib.contextmanager
def running(handler=echo, limits=proxy.Limits()):
    upstream = Upstream(handler)
    relay = RunningRelay(upstream.port, limits)
    try:
        yield relay, upstream
    finally:
        relay.close()
        upstream.close()


class RequestTests(unittest.TestCase):
    def bridge_request(self, credential=None):
        value = base64.b64encode(b"prapor:" + TOKEN) if credential is None else credential
        return b"CONNECT github.com:443 HTTP/1.1\r\nProxy-Authorization: Basic " + value + b"\r\n\r\n"

    def test_only_exact_destination_method_protocol_and_client_network(self):
        self.assertEqual(proxy.check_request(REQUEST, "127.0.0.1", TOKEN), 0)
        self.assertEqual(proxy.check_request(REQUEST.replace(b"1.1", b"1.0"), "127.0.0.1", TOKEN), 0)
        for target in (b"example.com:443", b"github.com:80", b"github.com.:443", b"github.com:443@evil", b"GITHUB.COM:443"):
            self.assertEqual(proxy.check_request(REQUEST.replace(b"github.com:443", target), "127.0.0.1", TOKEN), 403)
        self.assertEqual(proxy.check_request(REQUEST.replace(b"CONNECT", b"GET"), "127.0.0.1", TOKEN), 405)
        self.assertEqual(proxy.check_request(REQUEST.replace(b"HTTP/1.1", b"HTTP/2"), "127.0.0.1", TOKEN), 400)
        for peer in ("127.0.0.2", "172.17.1.2", "172.19.1.2", "8.8.8.8", "::1", "::ffff:127.0.0.1"):
            self.assertEqual(proxy.check_request(self.bridge_request(), peer, TOKEN), 403)

    def test_bridge_requires_valid_basic_auth_with_constant_time_comparison(self):
        for peer in ("172.18.0.2", "172.18.255.254"):
            self.assertEqual(proxy.check_request(REQUEST, peer, TOKEN), 407)
            self.assertEqual(proxy.check_request(self.bridge_request(), peer, TOKEN), 0)
        for credential in (b"not-base64", base64.b64encode(b"other:" + TOKEN), base64.b64encode(b"prapor:wrong")):
            self.assertEqual(proxy.check_request(self.bridge_request(credential), "172.18.0.2", TOKEN), 407)
        with mock.patch.object(proxy.hmac, "compare_digest", wraps=proxy.hmac.compare_digest) as compare:
            self.assertEqual(proxy.check_request(self.bridge_request(), "172.18.0.2", TOKEN), 0)
            compare.assert_called_once()

    def test_rejects_ambiguous_framing_duplicate_auth_and_oversized_headers(self):
        for extra in (b"Transfer-Encoding: chunked\r\n", b"Content-Length: 1\r\n", b" folded\r\n", b"Name: bad\x00value\r\n"):
            self.assertEqual(proxy.check_request(REQUEST[:-2] + extra + b"\r\n", "127.0.0.1", TOKEN), 400)
        duplicate = self.bridge_request()[:-2] + b"Proxy-Authorization: Basic anything\r\n\r\n"
        self.assertEqual(proxy.check_request(duplicate, "172.18.0.2", TOKEN), 400)
        prefix = b"CONNECT github.com:443 HTTP/1.1\r\nX: "
        exact = prefix + b"a" * (proxy.HEADER_LIMIT - len(prefix) - 4) + b"\r\n\r\n"
        self.assertEqual(proxy.check_request(exact, "127.0.0.1", TOKEN), 0)
        self.assertEqual(proxy.check_request(exact[:-4] + b"a\r\n\r\n", "127.0.0.1", TOKEN), 400)

    def test_token_constraints_and_fixed_binding(self):
        self.assertEqual(proxy.validate_token(TOKEN + b"\n"), TOKEN)
        self.assertEqual(proxy.validate_token(TOKEN + b"\r\n"), TOKEN)
        for token in (b"short", b"x" * 257, TOKEN + b"\n\n", b" " + TOKEN, TOKEN + b"\x00"):
            with self.assertRaises(proxy.ConfigurationError):
                proxy.validate_token(token)
        with mock.patch.object(proxy.socket, "socket") as factory:
            first, second = mock.Mock(), mock.Mock()
            factory.side_effect = [first, second]
            self.assertEqual(proxy.bind_listeners(), [first, second])
            first.bind.assert_called_once_with(("127.0.0.1", 19644))
            second.bind.assert_called_once_with(("172.18.0.1", 19644))
        self.assertEqual(proxy.UPSTREAM_PORT, 19643)

    def test_credential_owner_may_be_root_or_dynamic_uid_but_never_another_user(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=12345, st_gid=12345, st_dev=1, st_ino=2, st_size=len(TOKEN))
        with (mock.patch.object(proxy.os, "name", "posix"),
              mock.patch.object(proxy.os, "geteuid", return_value=12345, create=True),
              mock.patch.object(proxy.os, "getegid", return_value=12345, create=True),
              mock.patch.object(proxy.os, "lstat", return_value=metadata),
              mock.patch.object(proxy.os, "fstat", return_value=metadata),
              mock.patch.object(proxy.os, "open", return_value=999999),
              mock.patch.object(proxy.os, "read", return_value=TOKEN),
              mock.patch.object(proxy.os, "close")):
            self.assertEqual(proxy.load_token("credential"), TOKEN)
            metadata.st_uid = 0
            self.assertEqual(proxy.load_token("credential"), TOKEN)
            metadata.st_mode = stat.S_IFREG | 0o440
            self.assertEqual(proxy.load_token("credential"), TOKEN)
            metadata.st_gid = 54321
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token("credential")
            metadata.st_mode = stat.S_IFREG | 0o400
            self.assertEqual(proxy.load_token("credential"), TOKEN)
            metadata.st_gid = 12345
            for mode in (0o444, 0o442, 0o441, 0o460, 0o450):
                metadata.st_mode = stat.S_IFREG | mode
                with self.assertRaises(proxy.ConfigurationError):
                    proxy.load_token("credential")
            metadata.st_mode = stat.S_IFREG | 0o440
            metadata.st_uid = 54321
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token("credential")
            metadata.st_uid, metadata.st_mode = 0, stat.S_IFREG | 0o644
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token("credential")
            metadata.st_mode = stat.S_IFLNK | 0o400
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token("credential")

    def test_systemd_acl_copy_requires_exact_private_readonly_credential_namespace(self):
        directory = os.path.abspath("systemd-private-credentials")
        path = os.path.join(directory, "proxy_token")
        metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o440, st_uid=0, st_gid=0, st_dev=1, st_ino=2, st_size=len(TOKEN))
        parent = SimpleNamespace(st_mode=stat.S_IFDIR | 0o550, st_uid=0, st_gid=0)
        filesystem = SimpleNamespace(f_flag=1)
        with (mock.patch.dict(proxy.os.environ, {"CREDENTIALS_DIRECTORY": directory}),
              mock.patch.object(proxy.os, "name", "posix"),
              mock.patch.object(proxy.os, "geteuid", return_value=62642, create=True),
              mock.patch.object(proxy.os, "getegid", return_value=62642, create=True),
              mock.patch.object(proxy.os.path, "realpath", side_effect=lambda value: value),
              mock.patch.object(proxy.os, "lstat", side_effect=lambda value: parent if value == directory else metadata),
              mock.patch.object(proxy.os, "fstat", return_value=metadata),
              mock.patch.object(proxy.os, "statvfs", return_value=filesystem, create=True),
              mock.patch.object(proxy.os, "ST_RDONLY", 1, create=True),
              mock.patch.object(proxy.os, "open", return_value=999999),
              mock.patch.object(proxy.os, "read", return_value=TOKEN),
              mock.patch.object(proxy.os, "close")):
            self.assertEqual(proxy.load_token(path), TOKEN)
            filesystem.f_flag = 0
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(path)
            filesystem.f_flag = 1
            for foreign in (os.path.join(directory, "another_token"), os.path.abspath("outside-proxy_token"), "proxy_token"):
                with self.assertRaises(proxy.ConfigurationError):
                    proxy.load_token(foreign)
            metadata.st_uid = 54321
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(path)
            metadata.st_uid = 0
            metadata.st_mode = stat.S_IFREG | 0o444
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(path)
            metadata.st_mode = stat.S_IFREG | 0o440
            parent.st_uid = 54321
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(path)
            parent.st_uid = 0
            for mode in (0o570, 0o750, 0o554):
                parent.st_mode = stat.S_IFDIR | mode
                with self.assertRaises(proxy.ConfigurationError):
                    proxy.load_token(path)

    @unittest.skipUnless(os.name == "posix", "POSIX credential ownership")
    def test_private_credential_accepts_effective_uid_and_rejects_public_file_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "proxy_token"
            path.write_bytes(TOKEN)
            path.chmod(0o600)
            self.assertEqual(proxy.load_token(path), TOKEN)
            path.chmod(0o440)
            self.assertEqual(proxy.load_token(path), TOKEN)
            path.chmod(0o644)
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(path)
            path.chmod(0o400)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(proxy.ConfigurationError):
                proxy.load_token(link)


class SocketTests(unittest.TestCase):
    def test_binary_header_tail_and_fragmented_request_are_forwarded_exactly(self):
        payload = bytes(range(256)) * 31
        with running() as (relay, _):
            with relay.connect() as client:
                request = REQUEST[:-2] + b"Proxy-Authorization: Basic " + base64.b64encode(b"prapor:" + TOKEN) + b"\r\n\r\n"
                client.sendall(request[:17])
                client.sendall(request[17:] + payload)
                header, tail = receive_header(client)
                self.assertEqual(header, proxy.response(200))
                received = bytearray(tail)
                while len(received) < len(payload):
                    received.extend(client.recv(16384))
                self.assertEqual(bytes(received), payload)

    def test_client_eof_drains_large_response_and_backpressure_stays_bounded(self):
        request = bytes(range(256)) * 2048
        reply = b"reply:" + request[::-1]

        def handler(connection):
            time.sleep(.05)
            self.assertEqual(receive_all(connection), request)
            connection.sendall(reply)

        with running(handler) as (relay, _):
            with relay.connect() as client:
                client.settimeout(5)
                client.sendall(REQUEST)
                self.assertEqual(receive_header(client)[0], proxy.response(200))
                client.sendall(request)
                client.shutdown(socket.SHUT_WR)
                time.sleep(.1)
                self.assertEqual(receive_all(client), reply)
            self.assertLessEqual(relay.relay.peak_buffer, proxy.BUFFER_LIMIT)
            self.assertGreaterEqual(relay.relay.peak_buffer, 16384)

    def test_upstream_half_close_keeps_opposite_direction_open(self):
        captured = []

        def handler(connection):
            connection.sendall(b"server-finished")
            connection.shutdown(socket.SHUT_WR)
            captured.append(receive_all(connection))

        with running(handler) as (relay, _):
            with relay.connect() as client:
                client.sendall(REQUEST)
                _, tail = receive_header(client)
                self.assertEqual(tail + receive_all(client), b"server-finished")
                client.sendall(b"still-allowed-after-read-eof")
                client.shutdown(socket.SHUT_WR)
                wait_for(lambda: bool(captured))
            self.assertEqual(captured, [b"still-allowed-after-read-eof"])

    def test_failure_never_sends_200_and_bad_target_never_reaches_upstream(self):
        unused = socket.socket()
        unused.bind(("127.0.0.1", 0))
        port = unused.getsockname()[1]
        unused.close()
        relay = RunningRelay(port)
        try:
            with relay.connect() as client:
                client.sendall(REQUEST)
                self.assertTrue(receive_header(client)[0].startswith(b"HTTP/1.1 502 "))
        finally:
            relay.close()
        with running() as (relay, upstream):
            with relay.connect() as client:
                client.sendall(REQUEST.replace(b"github.com:443", b"example.com:443"))
                self.assertTrue(receive_header(client)[0].startswith(b"HTTP/1.1 403 "))
            self.assertEqual(upstream.accepted, 0)

    def test_connection_and_header_limits_release_resources(self):
        with running() as (relay, upstream):
            clients = [relay.connect() for _ in range(proxy.MAX_CONNECTIONS)]
            try:
                wait_for(lambda: len(relay.relay.connections) == proxy.MAX_CONNECTIONS)
                with relay.connect() as ninth:
                    self.assertEqual(ninth.recv(1), b"")
                self.assertEqual(upstream.accepted, 0)
            finally:
                for client in clients:
                    client.close()
            wait_for(lambda: not relay.relay.connections)
            with relay.connect() as client:
                client.sendall(b"CONNECT github.com:443 HTTP/1.1\r\nX: " + b"a" * proxy.HEADER_LIMIT)
                self.assertTrue(receive_header(client)[0].startswith(b"HTTP/1.1 400 "))

    def test_wrong_loopback_source_is_rejected_even_with_valid_bridge_credential(self):
        with running() as (relay, upstream):
            try:
                client = relay.connect(source="127.0.0.2")
            except OSError:
                self.skipTest("additional loopback source unavailable")
            with client:
                try:
                    client.sendall(REQUEST[:-2] + b"Proxy-Authorization: Basic " + base64.b64encode(b"prapor:" + TOKEN) + b"\r\n\r\n")
                    self.assertEqual(client.recv(1), b"")
                except ConnectionResetError:
                    pass
            self.assertEqual(upstream.accepted, 0)

    def test_header_deadline_and_idle_deadline(self):
        limits = proxy.Limits(header_seconds=.12, idle_seconds=.12, connection_seconds=2)
        with running(limits=limits) as (relay, _):
            with relay.connect() as client:
                client.sendall(b"CON")
                self.assertEqual(client.recv(1), b"")
            with relay.connect() as client:
                client.sendall(REQUEST)
                self.assertEqual(receive_header(client)[0], proxy.response(200))
                self.assertEqual(client.recv(1), b"")

    def test_active_connection_has_total_cap_but_daemon_accepts_later_connection(self):
        limits = proxy.Limits(header_seconds=1, idle_seconds=1, connection_seconds=.22)
        with running(limits=limits) as (relay, _):
            with relay.connect() as client:
                client.sendall(REQUEST)
                receive_header(client)
                start = time.monotonic()
                while True:
                    try:
                        client.sendall(b"ping")
                        if not client.recv(4):
                            break
                    except (ConnectionError, OSError):
                        break
                    time.sleep(.02)
                self.assertLess(time.monotonic() - start, .8)
            with relay.connect() as client:
                client.sendall(REQUEST)
                self.assertEqual(receive_header(client)[0], proxy.response(200))

    def test_stop_closes_live_connection_and_listener(self):
        upstream = Upstream(echo)
        relay = RunningRelay(upstream.port)
        try:
            with relay.connect() as client:
                client.sendall(REQUEST)
                receive_header(client)
                relay.close()
                self.assertEqual(client.recv(1), b"")
                with self.assertRaises(OSError):
                    socket.create_connection(("127.0.0.1", relay.port), timeout=.2)
        finally:
            upstream.close()


if __name__ == "__main__":
    unittest.main()
