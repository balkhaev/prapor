#!/usr/bin/env python3
"""Bounded GitHub CONNECT egress. TLS and GitHub credentials stay end to end."""
import base64
import binascii
from dataclasses import dataclass
import errno
import hmac
import ipaddress
import os
import selectors
import signal
import socket
import stat
import sys
import threading
import time

BIND_ADDRESSES = ("127.0.0.1", "172.18.0.1")
LISTEN_PORT = 19644
UPSTREAM_PORT = 19643
BRIDGE_NETWORK = ipaddress.IPv4Network("172.18.0.0/16")
HEADER_LIMIT = 8192
BUFFER_LIMIT = 65536
MAX_CONNECTIONS = 8
NAME_BYTES = frozenset(b"!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")


@dataclass(frozen=True)
class Limits:
    header_seconds: float = 10.0
    connect_seconds: float = 10.0
    idle_seconds: float = 90.0
    connection_seconds: float = 1800.0


class ConfigurationError(Exception):
    pass


def validate_token(raw):
    token = raw.removesuffix(b"\n").removesuffix(b"\r")
    if not 32 <= len(token) <= 256 or any(byte < 33 or byte > 126 for byte in token):
        raise ConfigurationError()
    return token


def systemd_readonly_credential(path, metadata):
    """Recognize systemd's root-owned credential copy with per-service ACLs.

    Its 0440 group bits can be an ACL mask even when st_gid is root. The
    exception is confined to the exact canonical private read-only namespace.
    """
    directory = os.environ.get("CREDENTIALS_DIRECTORY")
    path = os.fspath(path)
    if (not directory or not os.path.isabs(directory) or not os.path.isabs(path)
            or directory != os.path.normpath(directory) or directory != os.path.realpath(directory)
            or path != os.path.join(directory, "proxy_token") or path != os.path.realpath(path)
            or metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o440):
        return False
    try:
        parent = os.lstat(directory)
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0
                or parent.st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IRWXO)):
            return False
        return bool(os.statvfs(path).f_flag & os.ST_RDONLY)
    except (OSError, AttributeError):
        return False


def load_token(path):
    """Accept root files and DynamicUser's private LoadCredential copy only."""
    if os.name != "posix":
        raise ConfigurationError()
    descriptor = None
    try:
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode):
            raise ConfigurationError()
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid not in (0, os.geteuid())
                or metadata.st_mode & (stat.S_IWGRP | stat.S_IXGRP | stat.S_IRWXO)
                or metadata.st_mode & stat.S_IRGRP and metadata.st_gid != os.getegid() and not systemd_readonly_credential(path, metadata)
                or (before.st_dev, before.st_ino) != (metadata.st_dev, metadata.st_ino)
                or metadata.st_size > 258):
            raise ConfigurationError()
        return validate_token(os.read(descriptor, 259))
    except (OSError, ValueError) as error:
        raise ConfigurationError() from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def client_kind(peer):
    try:
        address = ipaddress.IPv4Address(peer)
    except ipaddress.AddressValueError:
        return None
    if str(address) != peer:
        return None
    if peer == "127.0.0.1":
        return "local"
    if address in BRIDGE_NETWORK:
        return "bridge"
    return None


def check_request(header, peer, token):
    """Return an HTTP rejection code, or zero for the one permitted tunnel."""
    kind = client_kind(peer)
    if kind is None:
        return 403
    if len(header) > HEADER_LIMIT or not header.endswith(b"\r\n\r\n"):
        return 400
    lines = header[:-4].split(b"\r\n")
    request = lines[0].split(b" ")
    if len(request) != 3 or request[2] not in (b"HTTP/1.0", b"HTTP/1.1"):
        return 400
    if request[0] != b"CONNECT":
        return 405
    if request[1] != b"github.com:443":
        return 403
    authorization = None
    for line in lines[1:]:
        name, separator, value = line.partition(b":")
        if not separator or not name or any(byte not in NAME_BYTES for byte in name):
            return 400
        if any(byte < 32 and byte != 9 or byte > 126 for byte in value):
            return 400
        name = name.lower()
        if name == b"transfer-encoding" or name == b"content-length" and value.strip() != b"0":
            return 400
        if name == b"proxy-authorization":
            if authorization is not None:
                return 400
            authorization = value.strip()
    if kind == "local":
        return 0
    if authorization is None:
        return 407
    scheme, separator, encoded = authorization.partition(b" ")
    if not separator or scheme.lower() != b"basic":
        return 407
    try:
        credential = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return 407
    return 0 if hmac.compare_digest(credential, b"prapor:" + token) else 407


def response(status):
    reasons = {200: b"Connection Established", 400: b"Bad Request", 403: b"Forbidden", 405: b"Method Not Allowed", 407: b"Proxy Authentication Required", 502: b"Bad Gateway"}
    first = b"HTTP/1.1 " + str(status).encode("ascii") + b" " + reasons[status] + b"\r\n"
    if status == 200:
        return first + b"\r\n"
    auth = b'Proxy-Authenticate: Basic realm="prapor-git-egress"\r\n' if status == 407 else b""
    return first + auth + b"Connection: close\r\nContent-Length: 0\r\n\r\n"


def bind_listeners():
    listeners = []
    try:
        for address in BIND_ADDRESSES:
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listeners.append(listener)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.setblocking(False)
            listener.bind((address, LISTEN_PORT))
            listener.listen(MAX_CONNECTIONS)
        return listeners
    except OSError:
        for listener in listeners:
            listener.close()
        raise


class Connection:
    def __init__(self, client, peer, limits):
        self.client, self.peer, self.upstream = client, peer, None
        self.header, self.to_client, self.to_upstream = bytearray(), bytearray(), bytearray()
        self.state = "header"
        self.started = self.progress = time.monotonic()
        self.deadline = self.started + limits.header_seconds
        self.client_eof = self.upstream_eof = False
        self.client_shutdown = self.upstream_shutdown = False


class Relay:
    """An injected listener set lets tests exercise real sockets without a bridge."""
    def __init__(self, listeners, token, upstream_port=UPSTREAM_PORT, limits=Limits()):
        self.selector = selectors.DefaultSelector()
        self.listeners, self.token, self.upstream_port, self.limits = listeners, token, upstream_port, limits
        self.connections, self.errors, self.peak_buffer = {}, 0, 0
        self.stopping = threading.Event()
        for listener in listeners:
            listener.setblocking(False)
            self.selector.register(listener, selectors.EVENT_READ, None)

    def stop(self):
        self.stopping.set()

    def register(self, sock, events, data):
        if sock is None:
            return
        try:
            self.selector.get_key(sock)
        except KeyError:
            if events:
                self.selector.register(sock, events, data)
        else:
            if events:
                self.selector.modify(sock, events, data)
            else:
                self.selector.unregister(sock)

    def close_socket(self, sock):
        if sock is not None:
            try:
                self.selector.unregister(sock)
            except (KeyError, ValueError):
                pass
            sock.close()

    def close(self, connection):
        self.connections.pop(id(connection), None)
        self.close_socket(connection.client)
        self.close_socket(connection.upstream)
        connection.client = connection.upstream = None

    def fail(self, connection, status):
        self.errors += 1
        self.close_socket(connection.upstream)
        connection.upstream = None
        connection.header.clear()
        connection.to_upstream.clear()
        connection.to_client[:] = response(status)
        connection.state = "closing"
        connection.deadline = time.monotonic() + self.limits.header_seconds
        self.refresh(connection)

    def refresh(self, connection):
        if id(connection) not in self.connections:
            return
        client_events = upstream_events = 0
        if connection.state == "header":
            client_events = selectors.EVENT_READ
        elif connection.state == "connecting":
            upstream_events = selectors.EVENT_WRITE
        elif connection.state == "tunnel":
            if not connection.client_eof and len(connection.to_upstream) < BUFFER_LIMIT:
                client_events |= selectors.EVENT_READ
            if not connection.upstream_eof and len(connection.to_client) < BUFFER_LIMIT:
                upstream_events |= selectors.EVENT_READ
            if connection.to_upstream:
                upstream_events |= selectors.EVENT_WRITE
        if connection.to_client:
            client_events |= selectors.EVENT_WRITE
        if connection.state == "closing" and not connection.to_client:
            self.close(connection)
            return
        if connection.state == "tunnel":
            for eof, pending, target, attribute in (
                (connection.client_eof, connection.to_upstream, connection.upstream, "upstream_shutdown"),
                (connection.upstream_eof, connection.to_client, connection.client, "client_shutdown"),
            ):
                if eof and not pending and not getattr(connection, attribute):
                    try:
                        target.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    setattr(connection, attribute, True)
            if connection.client_eof and connection.upstream_eof and not connection.to_client and not connection.to_upstream:
                self.close(connection)
                return
        self.peak_buffer = max(self.peak_buffer, len(connection.to_client), len(connection.to_upstream))
        self.register(connection.client, client_events, (connection, "client"))
        self.register(connection.upstream, upstream_events, (connection, "upstream"))

    def connected(self, connection):
        connection.state = "tunnel"
        connection.to_client[:] = response(200)
        connection.progress = time.monotonic()
        self.refresh(connection)

    def begin_connect(self, connection):
        connection.upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        connection.upstream.setblocking(False)
        connection.state = "connecting"
        connection.deadline = time.monotonic() + self.limits.connect_seconds
        result = connection.upstream.connect_ex(("127.0.0.1", self.upstream_port))
        if result == 0:
            self.connected(connection)
        elif result in (errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR):
            self.refresh(connection)
        else:
            self.fail(connection, 502)

    def accept(self, listener):
        for _ in range(MAX_CONNECTIONS * 2):
            try:
                client, peer = listener.accept()
            except BlockingIOError:
                return
            client.setblocking(False)
            if len(self.connections) >= MAX_CONNECTIONS or client_kind(peer[0]) is None:
                self.errors += 1
                client.close()
                continue
            connection = Connection(client, peer[0], self.limits)
            self.connections[id(connection)] = connection
            self.refresh(connection)

    def event(self, connection, side, mask):
        if id(connection) not in self.connections:
            return
        if connection.state == "connecting" and side == "upstream":
            if connection.upstream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR):
                self.fail(connection, 502)
            else:
                self.connected(connection)
            return
        sock = connection.client if side == "client" else connection.upstream
        if mask & selectors.EVENT_WRITE:
            pending = connection.to_client if side == "client" else connection.to_upstream
            if pending:
                try:
                    sent = sock.send(pending)
                except BlockingIOError:
                    sent = None
                if sent == 0:
                    raise ConnectionError()
                if sent:
                    del pending[:sent]
                    connection.progress = time.monotonic()
        if mask & selectors.EVENT_READ:
            if connection.state == "header":
                data = sock.recv(min(4096, HEADER_LIMIT + 1 - len(connection.header)))
                if not data:
                    self.close(connection)
                    return
                connection.header.extend(data)
                end = connection.header.find(b"\r\n\r\n")
                if end >= 0:
                    end += 4
                    status = check_request(bytes(connection.header[:end]), connection.peer, self.token)
                    if status:
                        self.fail(connection, status)
                        return
                    connection.to_upstream.extend(connection.header[end:])
                    connection.header.clear()
                    self.begin_connect(connection)
                    return
                if len(connection.header) > HEADER_LIMIT:
                    self.fail(connection, 400)
                    return
            elif connection.state == "tunnel":
                pending = connection.to_upstream if side == "client" else connection.to_client
                capacity = BUFFER_LIMIT - len(pending)
                if capacity:
                    data = sock.recv(min(16384, capacity))
                    if data:
                        pending.extend(data)
                        connection.progress = time.monotonic()
                    elif side == "client":
                        connection.client_eof = True
                    else:
                        connection.upstream_eof = True
        self.refresh(connection)

    def cleanup(self):
        for connection in list(self.connections.values()):
            self.close(connection)
        for listener in self.listeners:
            self.close_socket(listener)
        self.listeners.clear()
        self.selector.close()

    def run(self, log=True):
        if log:
            print("ready", flush=True)
        try:
            while not self.stopping.is_set():
                now = time.monotonic()
                deadlines = [min(c.started + self.limits.connection_seconds, c.progress + self.limits.idle_seconds if c.state == "tunnel" else c.deadline) for c in self.connections.values()]
                wait = max(0.0, min(1.0, min(deadlines) - now)) if deadlines else 1.0
                for key, mask in self.selector.select(wait):
                    try:
                        if key.data is None:
                            self.accept(key.fileobj)
                        else:
                            self.event(*key.data, mask)
                    except BlockingIOError:
                        if key.data is not None:
                            self.refresh(key.data[0])
                    except OSError:
                        self.errors += 1
                        if key.data is not None:
                            self.close(key.data[0])
                now = time.monotonic()
                for connection in list(self.connections.values()):
                    expired = now - connection.started >= self.limits.connection_seconds
                    expired |= now - connection.progress >= self.limits.idle_seconds if connection.state == "tunnel" else now >= connection.deadline
                    if expired:
                        self.errors += 1
                        self.close(connection)
        finally:
            self.cleanup()
            if log:
                print("stopped errors=" + str(self.errors), flush=True)


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    try:
        if len(arguments) == 2 and arguments[0] == "--credential-file":
            path = arguments[1]
        elif not arguments and os.environ.get("CREDENTIALS_DIRECTORY"):
            path = os.path.join(os.environ["CREDENTIALS_DIRECTORY"], "proxy_token")
        else:
            raise ConfigurationError()
        token = load_token(path)
        relay = Relay(bind_listeners(), token)
    except (ConfigurationError, OSError):
        print("configuration error", file=sys.stderr)
        return 2

    def stop(_signum, _frame):
        relay.stop()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        relay.run()
    except Exception:
        print("runtime error", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
