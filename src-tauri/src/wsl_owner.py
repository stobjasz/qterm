"""Fixed per-pane Linux supervisor. It never reads or relays the terminal input."""
import ctypes
import os
import pwd
import select
import signal
import sys
import time


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
    leader = os.fork()
    if leader == 0:
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
            select.select([], [], [], 0.1)
    finally:
        cleanup()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("qterm: WSL ownership failed: " + str(error), file=sys.stderr, flush=True)
        sys.exit(126)
