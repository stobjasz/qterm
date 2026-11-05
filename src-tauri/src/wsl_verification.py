"""Fixed-context, authenticated repository monitors owned by a Windows lifetime."""
import hashlib
import hmac
import json
import os
import re
import select
import signal
import socket
import stat
import struct
import threading
import time


class VerificationEnded(BaseException):
    pass


def verification_token(value):
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value):
        raise ValueError("Invalid verification monitor token")
    return value


def verification_address(token):
    return "\0qterm-verification-" + hashlib.sha256(token.encode()).hexdigest()


def verification_lifetime(path, token, expected=None):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size != 64:
                return None
            identity = (info.st_dev, info.st_ino)
            if expected is not None and identity != expected:
                return None
            if os.read(fd, 65) != token.encode("ascii"):
                return None
            current = os.stat(path, follow_symlinks=False)
            return identity if (current.st_dev, current.st_ino) == identity else None
        finally:
            os.close(fd)
    except OSError:
        return None


def verification_control(server, token, lifetime, identity, coverage, cwd):
    connection, _ = server.accept()
    with connection:
        connection.settimeout(0.5)
        _, uid, _ = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != os.getuid():
            return False
        raw = b""
        while b"\n" not in raw and len(raw) <= 2048:
            chunk = connection.recv(2049 - len(raw))
            if not chunk:
                return False
            raw += chunk
        if len(raw) > 2048:
            return False
        request = json.loads(raw)
        if set(request) != {"nonce", "method", "expires", "proof"}:
            return False
        nonce, method, expires = request["nonce"], request["method"], request["expires"]
        if not isinstance(nonce, str) or not re.fullmatch("[0-9a-f]{32}", nonce) or method not in ("status", "finish", "cancel") or type(expires) is not int:
            return False
        proof = hmac.new(token.encode(), (nonce + "\n" + method + "\n" + str(expires)).encode(), hashlib.sha256).hexdigest()
        if not isinstance(request["proof"], str) or not hmac.compare_digest(proof, request["proof"]):
            return False
        closing = False
        try:
            now = time.monotonic_ns()
            if not now < expires <= now + 20_000_000_000:
                raise ValueError("Verification request expired; no monitor action was performed")
            if verification_lifetime(lifetime, token, identity) is None:
                raise ValueError("The Windows verification owner is unavailable")
            if method == "cancel":
                result, closing = True, True
            else:
                closing = method == "finish"
                changed = coverage.changed()
                after = None
                if method == "finish":
                    closing = True
                    if not changed:
                        after = repository_capture(cwd, coverage.identities)
                        changed = coverage.changed()
                result = {"changed": changed, "after": after}
            if time.monotonic_ns() >= expires or verification_lifetime(lifetime, token, identity) is None:
                raise ValueError("Verification request expired or its Windows owner ended")
            response = {"result": result}
        except Exception as error:
            response = {"error": str(error)[:2000]}
        payload = json.dumps(response, ensure_ascii=True)
        proof = hmac.new(token.encode(), (nonce + "\n" + payload).encode(), hashlib.sha256).hexdigest()
        connection.sendall((json.dumps({"payload": payload, "proof": proof}) + "\n").encode())
        return closing


def verification_child(server, ready, token, lifetime, identity, cwd):
    coverage = None
    stopped = threading.Event()

    def end(_signal, _frame):
        raise VerificationEnded("Windows verification lifetime ended")

    def watch_lifetime():
        while not stopped.wait(0.1):
            if verification_lifetime(lifetime, token, identity) is None:
                os.kill(os.getpid(), signal.SIGTERM)
                return

    try:
        os.setsid()
        signal.alarm(0)
        signal.signal(signal.SIGTERM, end)
        signal.signal(signal.SIGHUP, end)
        null = os.open("/dev/null", os.O_RDWR | os.O_CLOEXEC)
        try:
            for fd in (0, 1, 2):
                os.dup2(null, fd)
        finally:
            if null > 2:
                os.close(null)
        for item in os.listdir("/proc/self/fd"):
            fd = int(item)
            if fd > 2 and fd not in (server.fileno(), ready):
                try:
                    os.close(fd)
                except OSError:
                    pass
        threading.Thread(target=watch_lifetime, daemon=True).start()
        cwd = repo_folder(cwd)
        coverage = RepositoryCoverage(cwd)
        before = repository_capture(cwd, coverage.identities)
        if coverage.changed():
            raise ValueError("Linux repository changed during verification preparation")
        fields = open("/proc/self/stat", encoding="utf-8").read().rpartition(") ")[2].split()
        response = {"cwd": cwd, "before": before, "identity": [os.getpid(), int(fields[19])]}
        handle, ready = ready, -1
        with os.fdopen(handle, "wb") as stream:
            stream.write(json.dumps({"result": response}, ensure_ascii=True).encode())
        while True:
            inputs = [server]
            if not coverage.error and not coverage.changed_forever:
                inputs.append(coverage.fd)
            available = select.select(inputs, [], [], 0.1)[0]
            if server in available:
                try:
                    if verification_control(server, token, lifetime, identity, coverage, cwd):
                        return
                except (OSError, ValueError, TypeError, KeyError):
                    pass
            if coverage.fd in available:
                try:
                    coverage.changed()
                except Exception:
                    pass  # Coverage retains the error for authenticated callers.
    except BaseException as error:
        if ready >= 0:
            handle, ready = ready, -1
            try:
                with os.fdopen(handle, "wb") as stream:
                    stream.write(json.dumps({"error": str(error)[:2000]}).encode())
            except OSError:
                pass
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        try:
            stopped.set()
            if coverage is not None:
                coverage.close()
            server.close()
            if ready >= 0:
                os.close(ready)
        finally:
            os._exit(0)


def verification_start(request):
    token = verification_token(request["token"])
    lifetime = request["lifetime"]
    if not isinstance(lifetime, str) or not lifetime.startswith("/") or len(lifetime) > 4096 or any(ord(c) < 32 for c in lifetime):
        raise ValueError("Invalid Windows verification lifetime path")
    identity = verification_lifetime(lifetime, token)
    if identity is None:
        raise ValueError("The Windows verification owner is unavailable")
    cwd = repo_folder(request["cwd"])
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    read = write = None
    child = None
    try:
        server.bind(verification_address(token))
        server.listen(4)
        read, write = os.pipe2(os.O_CLOEXEC)
        child = os.fork()
        if child == 0:
            verification_child(server, write, token, lifetime, identity, cwd)
        server.close()
        os.close(write)
        write = None
        deadline = time.monotonic() + 19
        raw = b""
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([read], [], [], remaining)[0]:
                raise ValueError("Linux verification monitor startup timed out")
            chunk = os.read(read, 8192)
            if not chunk:
                break
            raw += chunk
            if len(raw) > 65536:
                raise ValueError("Linux verification startup response exceeded its bound")
        response = json.loads(raw)
        if "error" in response:
            raise ValueError(response["error"])
        return response["result"]
    except BaseException:
        if child is not None and child > 0:
            try:
                os.kill(child, signal.SIGTERM)  # Only our unreaped fork child.
            except ProcessLookupError:
                pass
        raise
    finally:
        server.close()
        if read is not None:
            os.close(read)
        if write is not None:
            os.close(write)


def verification_request(request):
    token = verification_token(request["token"])
    method = request["action"]
    if method not in ("status", "finish", "cancel"):
        raise ValueError("Invalid verification monitor action")
    nonce = os.urandom(16).hex()
    expires = time.monotonic_ns() + 15_000_000_000
    proof = hmac.new(token.encode(), (nonce + "\n" + method + "\n" + str(expires)).encode(), hashlib.sha256).hexdigest()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(16)
        client.connect(verification_address(token))
        _, uid, _ = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != os.getuid():
            raise ValueError("Verification monitor belongs to another Linux user")
        client.sendall((json.dumps({"nonce": nonce, "method": method, "expires": expires, "proof": proof}) + "\n").encode())
        raw = b""
        while b"\n" not in raw:
            chunk = client.recv(8192)
            if not chunk:
                raise ValueError("Verification monitor closed its response")
            raw += chunk
            if len(raw) > 1_048_576:
                raise ValueError("Verification monitor response exceeded 1 MiB")
        envelope = json.loads(raw)
        proof = hmac.new(token.encode(), (nonce + "\n" + envelope["payload"]).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(proof, envelope["proof"]):
            raise ValueError("Verification monitor response authentication failed")
        response = json.loads(envelope["payload"])
        if "error" in response:
            raise ValueError(response["error"])
        return response["result"]
