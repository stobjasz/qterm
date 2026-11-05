"""Fixed per-pane Linux supervisor. It never reads or relays the terminal input."""
import ctypes
import hashlib
import hmac
import json
import os
import pwd
import select
import signal
import socket
import struct
import sys
import time


def exited(handle):
    poll = select.poll()
    poll.register(handle, select.POLLIN)
    return bool(poll.poll(0))


def process_tree():
    """Pin each child while its pinned parent is still alive; never scan other trees."""
    found = []
    seen = {os.getpid()}
    deadline = time.monotonic() + 1
    try:
        parents = [(os.getpid(), None)]
        while parents:
            parent, parent_handle = parents.pop()
            if parent_handle is not None and exited(parent_handle):
                continue
            try:
                candidates = set()
                # A process can fork from any worker thread; the leader's own
                # children file alone misses those programs.
                with os.scandir('/proc/' + str(parent) + '/task') as tasks:
                    for count, task in enumerate(tasks):
                        if count >= 4096 or time.monotonic() > deadline:
                            raise RuntimeError('Linux thread inspection exceeded its bound')
                        try:
                            with open(task.path + '/children', 'rb') as stream:
                                raw = stream.read(65537)
                        except FileNotFoundError:
                            continue
                        if len(raw) > 65536:
                            raise RuntimeError('Linux child list exceeded its bound')
                        candidates.update(int(value) for value in raw.split())
                        if len(candidates) > 4096:
                            raise RuntimeError('Linux child list exceeded its bound')
            except FileNotFoundError:
                continue
            for pid in candidates:
                if pid in seen:
                    continue
                if len(found) >= 4096 or time.monotonic() > deadline:
                    raise RuntimeError('Linux process inspection exceeded its bound')
                handle = None
                try:
                    handle = os.pidfd_open(pid)
                    with open('/proc/' + str(pid) + '/stat', 'rb') as stream:
                        fields = stream.read(8192).rsplit(b')', 1)[1].split()
                    if int(fields[1]) != parent:
                        continue
                    # If the parent exited, /proc/<parent> may now describe a
                    # reused PID. Do not accept any children through that path.
                    if parent_handle is not None and exited(parent_handle):
                        continue
                    if exited(handle):
                        continue
                    with open('/proc/' + str(pid) + '/comm', encoding='utf-8', errors='replace') as stream:
                        name = ''.join(c for c in stream.read(257).strip() if c.isprintable())[:256] or 'Linux program'
                    seen.add(pid)
                    found.append((pid, handle, name))
                    parents.append((pid, handle))
                    handle = None
                except (FileNotFoundError, ProcessLookupError):
                    pass
                finally:
                    if handle is not None:
                        os.close(handle)
        return found
    except BaseException:
        for _, handle, _ in found:
            os.close(handle)
        raise


def shell_invocation(executable, argv, shells):
    """Match a declared shell invocation, not just a shared executable image."""
    if not argv:
        return False
    names = shells.get(executable, set())
    name = os.path.basename(argv[0]).lstrip('-')
    args = argv[1:]
    if name == 'busybox' and args:
        name, args = args[0], args[1:]
    if name not in names:
        return False
    index = 0
    while index < len(args):
        value = args[index]
        if value in ('--rcfile', '--init-file', '-o', '+o', '-O', '+O'):
            index += 2
            if index > len(args):
                return False
            continue
        if value in ('--command', '--script') or value.startswith(('--command=', '--script=')) or (value.startswith(('-', '+')) and not value.startswith('--') and 'c' in value[1:]):
            return False
        if value.startswith('--') and value not in ('--login', '--interactive', '--noprofile', '--norc', '--noediting', '--posix', '--restricted', '--no-config'):
            return False
        if not value.startswith(('-', '+')) or value in ('-', '--'):
            return False  # A script/operand is not an interactive shell prompt.
        index += 1
    return True


def shell_leader(leader):
    executable = os.path.realpath('/proc/' + str(leader) + '/exe', strict=True)
    declared = [pwd.getpwuid(os.getuid()).pw_shell or '/bin/sh']
    try:
        with open('/etc/shells', encoding='utf-8') as stream:
            for line in stream:
                value = line.strip()
                if value.startswith('/'):
                    declared.append(value)
    except FileNotFoundError:
        pass
    shells = {}
    for value in declared:
        shells.setdefault(os.path.realpath(value), set()).add(os.path.basename(value))
    with open('/proc/' + str(leader) + '/cmdline', 'rb') as stream:
        raw = stream.read(8193)
    if len(raw) > 8192 or not raw.endswith(b'\0'):
        return False
    argv = [value.decode('utf-8', 'surrogateescape') for value in raw[:-1].split(b'\0')]
    return shell_invocation(executable, argv, shells)


def programs(leader, stop, expires):
    if time.monotonic_ns() >= expires:
        raise RuntimeError('The Linux control request expired; no new programs were targeted')
    keep_leader = shell_leader(leader)
    if stop and not keep_leader:
        raise RuntimeError('This WSL profile is running a program directly, so there is no shell to keep. Interrupt it or close the pane explicitly.')
    names = []
    deadline = time.monotonic() + 1.5
    while True:
        processes = process_tree()
        targets, denied = 0, False
        try:
            for pid, handle, name in reversed(processes):
                if pid == leader and keep_leader:
                    continue
                targets += 1
                try:
                    if stop:
                        if time.monotonic_ns() >= expires:
                            raise RuntimeError('The Linux Stop request expired before all programs could be ended')
                        signal.pidfd_send_signal(handle, signal.SIGKILL)
                    if name not in names:
                        names.append(name)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    denied = True
            if denied:
                raise RuntimeError('Some privileged Linux programs could not be stopped by the user-level supervisor')
        finally:
            for _, handle, _ in processes:
                os.close(handle)
        if not stop or not targets:
            return names
        if time.monotonic() >= deadline:
            raise RuntimeError('Linux programs did not finish stopping within the deadline')
        # Allow kernel exit/reparenting before checking for children forked while
        # the previous snapshot was pinned. The interactive leader is never sent
        # a stop signal, and unrelated trees are never inspected.
        select.select([], [], [], 0.01)


def provider_presence():
    processes = process_tree()
    found = set()
    try:
        for pid, handle, _ in processes:
            try:
                image = os.path.basename(os.readlink('/proc/' + str(pid) + '/exe'))
                provider = image if image in ('claude', 'codex') else None
                if image in ('node', 'nodejs'):
                    with open('/proc/' + str(pid) + '/cmdline', 'rb') as stream:
                        raw = stream.read(8193)
                    if len(raw) > 8192 or not raw.endswith(b'\0'):
                        raise RuntimeError('A Node provider invocation exceeded its inspection bound')
                    argv = raw[:-1].split(b'\0')
                    # Inspect only the script position, never prompt arguments or
                    # arbitrary strings elsewhere in a process command line.
                    if len(argv) > 1:
                        script = argv[1].decode('utf-8', 'surrogateescape')
                        name = os.path.basename(script)
                        if name in ('claude', 'codex', 'codex.js'):
                            provider = 'codex' if name.startswith('codex') else 'claude'
                        elif script.endswith('/@anthropic-ai/claude-code/cli.js'):
                            provider = 'claude'
                if provider and not exited(handle):
                    found.add(provider)
            except (FileNotFoundError, ProcessLookupError):
                pass
        return sorted(found)
    finally:
        for _, handle, _ in processes:
            os.close(handle)


def control(server, token, leader, path, identity):
    connection, _ = server.accept()
    with connection:
        connection.settimeout(0.5)
        _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != os.getuid():
            return
        raw = b''
        while b'\n' not in raw and len(raw) <= 1024:
            chunk = connection.recv(1025 - len(raw))
            if not chunk:
                break
            raw += chunk
        request = json.loads(raw)
        nonce, method, expires = request['nonce'], request['method'], request['expires']
        if not isinstance(nonce, str) or len(nonce) != 32 or any(c not in '0123456789abcdef' for c in nonce) or method not in ('programs', 'stop', 'presence', 'ready', 'launch', 'can_stop') or type(expires) is not int:
            return
        proof = hmac.new(token.encode(), (nonce + '\n' + method + '\n' + str(expires)).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(proof, request['proof']):
            return
        try:
            now = time.monotonic_ns()
            if not now < expires <= now + 3_000_000_000:
                raise RuntimeError('The Linux control request expired; no new programs were targeted')
            if lifetime(path, token, identity) is None:
                raise RuntimeError('The Windows pane owner is unavailable')
            if leader is None:
                if method not in ('ready', 'launch'):
                    raise RuntimeError('Windows pane ownership is not prepared; no user shell is running')
                response = {'result': True}
            else:
                if method in ('ready', 'launch'):
                    raise RuntimeError('This pane already launched its user command')
                response = {'result': shell_leader(leader) if method == 'can_stop' else provider_presence() if method == 'presence' else programs(leader, method == 'stop', expires)}
        except Exception as error:
            response = {'error': str(error)[:2000]}
        payload = json.dumps(response, ensure_ascii=True)
        proof = hmac.new(token.encode(), (nonce + '\n' + payload).encode(), hashlib.sha256).hexdigest()
        connection.sendall((json.dumps({'payload': payload, 'proof': proof}) + '\n').encode())
        return method if response.get('result') is True else None


def lifetime(path, token, identity=None):
    try:
        info = os.stat(path)
        if identity is not None and (info.st_dev, info.st_ino) != identity:
            return None
        with open(path, "rb") as stream:
            if stream.read(129) != token.encode("ascii"):
                return None
        return info.st_dev, info.st_ino
    except OSError:
        return None


def children():
    # All orphaned descendants become direct children of this subreaper. Killing
    # direct children repeatedly also catches descendants of a killed shell,
    # including double forks and setsid(), without inspecting unrelated processes.
    with open("/proc/self/task/" + str(os.getpid()) + "/children", "rb") as stream:
        data = stream.read(65536)
    # Kernel children records end in a space. Never parse a clipped PID suffix.
    return [int(pid) for pid in data.rsplit(b" ", 1)[0].split()]


def reap(leader=None):
    result = None
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return result
        if pid == 0:
            return result
        if pid == leader:
            result = os.waitstatus_to_exitcode(status)


def cleanup():
    deadline = time.monotonic() + 5
    denied = set()
    while True:
        for pid in children():
            handle = None
            try:
                handle = os.pidfd_open(pid)
                signal.pidfd_send_signal(handle, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except PermissionError:
                denied.add(pid)
            finally:
                if handle is not None:
                    os.close(handle)
        reap()
        if not children():
            return
        if time.monotonic() >= deadline:
            if denied:
                raise RuntimeError("Privileged Linux descendants could not be ended by a user-level supervisor; full ownership requires the authorized root supervisor")
            raise RuntimeError("Linux descendant cleanup did not finish within five seconds")
        select.select([], [], [], 0.01)


def main():
    path = os.environ.pop("QTERM_LIFETIME", "")
    token = os.environ.pop("QTERM_OWNER_TOKEN", "")
    os.environ["WSLENV"] = ":".join(item for item in os.environ.get("WSLENV", "").split(":") if item.split("/")[0] not in ("QTERM_LIFETIME", "QTERM_OWNER_TOKEN"))
    if not path.startswith("/") or len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise RuntimeError("Windows lifetime path was not translated by WSLENV; restore Windows filesystem access")
    identity = lifetime(path, token)
    if identity is None:
        raise RuntimeError("The pane's Windows owner is unavailable; no shell was started")
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("Owned WSL panes require Python 3.9+ and Linux PID-file-descriptor support")
    handle = os.pidfd_open(os.getpid())
    try:
        signal.pidfd_send_signal(handle, 0)
    finally:
        os.close(handle)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), "Linux subreaper support is required")
    children()  # Require the ownership traversal before starting any user process.
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.set_inheritable(False)
    server.bind('\0qterm-owner-' + hashlib.sha256(token.encode()).hexdigest())
    server.listen(4)

    stopping = []

    def stop(signum, frame):
        stopping.append(signum)

    for signum in (signal.SIGHUP, signal.SIGTERM):
        signal.signal(signum, stop)
    # Bash takes control of the existing terminal and manages foreground process
    # groups itself. The supervisor does no terminal I/O and must survive Ctrl-C.
    ignored = (signal.SIGINT, signal.SIGQUIT, signal.SIGTSTP, signal.SIGTTIN, signal.SIGTTOU, signal.SIGWINCH)
    for signum in ignored:
        signal.signal(signum, signal.SIG_IGN)
    command = sys.argv[1:]
    if not command:
        shell = pwd.getpwuid(os.getuid()).pw_shell or "/bin/sh"
        command = [shell, "-l"]
    # Windows transport processes must be pinned before any user/profile code
    # can create an interop process that could be mistaken for infrastructure.
    bootstrap_deadline = time.monotonic() + 20
    while True:
        if stopping or lifetime(path, token, identity) is None:
            server.close()
            return 129
        if time.monotonic() >= bootstrap_deadline:
            server.close()
            raise RuntimeError('Windows pane ownership was not prepared; no shell was started')
        if select.select([server], [], [], 0.1)[0]:
            try:
                if control(server, token, None, path, identity) == 'launch':
                    break
            except (OSError, ValueError, KeyError, TypeError):
                pass
    leader = os.fork()
    if leader == 0:
        server.close()
        # Python ignores SIGPIPE and file-size signals at startup. Those ignored
        # dispositions survive exec unless restored, changing ordinary pipelines.
        restored = ignored + (signal.SIGHUP, signal.SIGTERM, signal.SIGPIPE, signal.SIGCHLD)
        restored += tuple(getattr(signal, name) for name in ("SIGXFZ", "SIGXFSZ") if hasattr(signal, name))
        for signum in restored:
            signal.signal(signum, signal.SIG_DFL)
        try:
            os.execvpe(command[0], command, os.environ)
        except OSError as error:
            os.write(2, ("qterm: could not start Linux shell: " + str(error) + "\n").encode())
            os._exit(127)
    try:
        while True:
            code = reap(leader)
            if code is not None:
                return code if code >= 0 else 128 - code
            if stopping or lifetime(path, token, identity) is None:
                return 128 + (stopping[0] if stopping else signal.SIGHUP)
            if select.select([server], [], [], 0.1)[0]:
                try:
                    control(server, token, leader, path, identity)
                except (OSError, ValueError, KeyError, TypeError):
                    # Invalid/slow clients cannot terminate ownership monitoring.
                    pass
    finally:
        server.close()
        cleanup()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("qterm: WSL ownership failed: " + str(error), file=sys.stderr, flush=True)
        sys.exit(126)
