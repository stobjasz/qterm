"""Bounded Linux repository snapshots and continuous inotify coverage.

This is bundled application code. It executes no shell, hooks, filters or tools
configured by a repository. Coverage owns kernel watches; callers must keep it
alive from before the initial snapshot until after the final snapshot.
"""
import hashlib
import os
import resource
import signal
import stat
import struct
import subprocess
import tempfile
import time

REPO_MAX_FILES = 20_000
REPO_MAX_BYTES = 128 * 1024 * 1024
REPO_MAX_WATCHES = 40_000
REPO_MAX_PATHS = 4096
REPO_TIMEOUT = 10
REPO_LOCAL_FILESYSTEMS = frozenset(("ext2", "ext3", "ext4", "btrfs", "xfs", "f2fs", "tmpfs"))


def repo_mount_table():
    with open("/proc/self/mountinfo", "rb") as stream:
        raw = stream.read(1_048_577)
    if len(raw) > 1_048_576 or len(raw.splitlines()) > 4096:
        raise ValueError("Linux mount information exceeded verification coverage")
    mounts = {}
    for line in raw.splitlines():
        before, separator, after = line.partition(b" - ")
        fields, details = before.split(), after.split()
        if not separator or len(fields) < 6 or len(details) < 3 or not fields[0].isdigit():
            raise ValueError("Linux mount identity could not be established")
        mounts[int(fields[0])] = (fields[2], details[0].decode("ascii"), line)
    return mounts


def repo_watch_mount(fd, mounts):
    with open("/proc/self/fdinfo/" + str(fd), "rb") as stream:
        raw = stream.read(8193)
    ids = [line.split(b":", 1)[1].strip() for line in raw.splitlines() if line.startswith(b"mnt_id:")]
    if len(raw) > 8192 or len(ids) != 1 or not ids[0].isdigit():
        raise ValueError("Linux watch mount identity is unavailable")
    mount_id = int(ids[0])
    record = mounts.get(mount_id)
    device = os.fstat(fd).st_dev
    if record is None or record[0] != f"{os.major(device)}:{os.minor(device)}".encode():
        raise ValueError("Linux watch mount changed during preparation")
    if record[1] not in REPO_LOCAL_FILESYSTEMS:
        raise ValueError("Linux verification cannot establish event coverage on filesystem " + record[1] + "; use a supported local Linux checkout or run without repository tracking")
    return mount_id


def repo_git(cwd, args, data=None, missing=False, deadline=None):
    remaining = min(6, deadline - time.monotonic()) if deadline is not None else 6
    if remaining <= 0:
        raise ValueError("Linux repository inspection exceeded its deadline")
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
    command = ["/usr/bin/git", "--no-pager", "--no-optional-locks",
               "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
               "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null",
               "-c", "submodule.recurse=false"]
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err, tempfile.TemporaryFile() as source:
        if data is not None:
            source.write(data)
            source.seek(0)
        # A monitor has a lifetime thread: never use preexec_fn after fork in a
        # multithreaded interpreter. Apply limits in a fresh isolated interpreter.
        launcher = "import os,resource,sys;resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304));os.execv(sys.argv[1],sys.argv[1:])"
        child = subprocess.Popen(["/usr/bin/python3", "-I", "-S", "-c", launcher, *command, *args], cwd=cwd, env=env,
                                 stdin=source if data is not None else subprocess.DEVNULL,
                                 stdout=out, stderr=err, start_new_session=True)
        try:
            code = child.wait(timeout=remaining)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        out.seek(0)
        value = out.read(4_194_305)
        if len(value) > 4_194_304 or code == -signal.SIGXFSZ:
            raise ValueError("Linux repository Git output exceeded 4 MiB")
        if code and not (missing and code == 1):
            err.seek(0)
            raise ValueError("Linux repository inspection failed: " + err.read(2000).decode("utf-8", "replace"))
        return value


def repo_folder(value):
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096 or any(ord(c) < 32 for c in value):
        raise ValueError("Expected an absolute Linux repository folder")
    value = os.path.realpath(value, strict=True)
    if not os.path.isdir(value):
        raise ValueError("Linux repository folder is unavailable")
    return value


def repo_field(cwd, args, deadline):
    return repo_git(cwd, args, deadline=deadline).decode("utf-8").rstrip("\r\n")


def repo_context(cwd, deadline):
    root = repo_folder(repo_field(repo_folder(cwd), ["rev-parse", "--show-toplevel"], deadline))
    metadata = sorted({repo_folder(repo_field(root, ["rev-parse", "--path-format=absolute", option], deadline))
                       for option in ("--git-dir", "--git-common-dir")})
    return root, metadata


def repo_paths(raw):
    paths = set()
    for item in raw.split(b"\0"):
        if not item:
            continue
        name = item.decode("utf-8")
        if name.startswith("/") or any(part in (".", "..", "") for part in name.rstrip("/").split("/")):
            raise ValueError("Linux repository path escapes its root")
        paths.add(name)
    return paths


def repo_inventory(root, deadline):
    paths = repo_paths(repo_git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], deadline=deadline))
    if len(paths) > REPO_MAX_FILES:
        raise ValueError("Linux repository exceeds 20000 files")
    return paths


def repo_identity(root, metadata, deadline):
    parts = [repo_git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], missing=True, deadline=deadline),
             repo_git(root, ["symbolic-ref", "--quiet", "HEAD"], missing=True, deadline=deadline),
             repo_git(root, ["ls-files", "--stage", "-z"], deadline=deadline)]
    identities = []
    for path in [root, *metadata]:
        info = os.stat(path)
        identities.append((path, info.st_dev, info.st_ino))
    return parts, identities


def repo_hash_field(digest, data):
    digest.update(struct.pack("<Q", len(data)))
    digest.update(data)


def repo_open_parent(root_fd, name):
    parent = os.dup(root_fd)
    try:
        for part in name.split("/")[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            os.close(parent)
            parent = child
        return parent
    except BaseException:
        os.close(parent)
        raise


def repo_open_dir(value):
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in value.strip("/").split("/"):
            if not part:
                continue
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def repository_capture(cwd, expected_identities=None):
    deadline = time.monotonic() + REPO_TIMEOUT
    root, metadata = repo_context(cwd, deadline)
    if expected_identities is not None:
        current = [(name, os.stat(name).st_dev, os.stat(name).st_ino) for name in [root, *metadata]]
        if current != expected_identities:
            raise ValueError("The reviewed Linux repository or its metadata was replaced")
    files = repo_inventory(root, deadline)
    before, identities = repo_identity(root, metadata, deadline)
    digest = hashlib.sha256(b"qterm-linux-repository-v1\0")
    for item in before:
        repo_hash_field(digest, item)
    for name, device, inode in identities:
        repo_hash_field(digest, os.fsencode(name))
        repo_hash_field(digest, struct.pack("<QQ", device, inode))
    total = 0
    root_fd = repo_open_dir(root)
    try:
        pinned = os.fstat(root_fd)
        if (pinned.st_dev, pinned.st_ino) != identities[0][1:]:
            raise ValueError("Linux repository root changed while opening it")
        for name in sorted(files):
            if time.monotonic() >= deadline:
                raise ValueError("Linux repository content hashing timed out")
            repo_hash_field(digest, name.encode("utf-8"))
            parent = None
            try:
                parent = repo_open_parent(root_fd, name)
                fd = os.open(name.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
            except FileNotFoundError:
                repo_hash_field(digest, b"missing")
                continue
            finally:
                if parent is not None:
                    os.close(parent)
            try:
                initial = os.fstat(fd)
                if not stat.S_ISREG(initial.st_mode):
                    raise ValueError("Linux repository entry is not a regular file: " + name)
                if total + initial.st_size > REPO_MAX_BYTES:
                    raise ValueError("Linux repository exceeds 128 MiB")
                repo_hash_field(digest, b"file")
                digest.update(struct.pack("<QQ", initial.st_size, initial.st_mode & 0o111))
                read = 0
                while True:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    read += len(chunk)
                    total += len(chunk)
                    if total > REPO_MAX_BYTES or time.monotonic() >= deadline:
                        raise ValueError("Linux repository grew or exceeded its capture limit")
                    digest.update(chunk)
                after = os.fstat(fd)
                current = os.stat(os.path.join(root, name), follow_symlinks=False)
                key = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode)
                if read != initial.st_size or key(initial) != key(after) or key(after) != key(current):
                    raise ValueError("Linux repository file changed during capture: " + name)
            finally:
                os.close(fd)
        if (before, identities) != repo_identity(root, metadata, deadline) or files != repo_inventory(root, deadline):
            raise ValueError("Linux repository changed while its state was captured")
        if time.monotonic() >= deadline:
            raise ValueError("Linux repository capture exceeded its deadline")
    finally:
        os.close(root_fd)
    return {"root": root, "head": before[0].decode("utf-8").strip() or None,
            "branch": before[1].decode("utf-8").strip() or None,
            "digest": digest.hexdigest(), "files": len(files), "bytes": total,
            "capturedAt": time.time_ns() // 1_000_000}


class RepositoryCoverage:
    # inotify(7): directory events plus individual source inode watches. Individual
    # watches also observe writes through hard links outside the watched directory.
    _event = struct.Struct("=iIII")
    _modify = 0x00000002 | 0x00000004 | 0x00000008
    _directory = _modify | 0x00000040 | 0x00000080 | 0x00000100 | 0x00000200 | 0x00000400 | 0x00000800

    def __init__(self, cwd):
        # Ordinary project/source operations do not require the watcher's FFI.
        import ctypes

        self._errno = ctypes.get_errno
        self.fd = -1
        self.error = None
        self.paths = set()
        self.watches = {}
        self.changed_forever = False
        self.mounts = repo_mount_table()
        self.watch_mounts = set()
        deadline = time.monotonic() + REPO_TIMEOUT
        self.root, self.metadata = repo_context(cwd, deadline)
        self.identities = [(path, os.stat(path).st_dev, os.stat(path).st_ino) for path in [self.root, *self.metadata]]
        self.sources = {os.path.join(self.root, name) for name in repo_inventory(self.root, deadline)}
        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.inotify_init1.argtypes = [ctypes.c_int]
        self.libc.inotify_init1.restype = ctypes.c_int
        self.libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self.libc.inotify_add_watch.restype = ctypes.c_int
        self.fd = self.libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), "Could not start Linux repository watcher")
        try:
            ignored = repo_paths(repo_git(self.root, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], deadline=deadline))
            candidates = ["target/", "src-tauri/target/", "node_modules/", "dist/", "build/", "coverage/", ".pytest_cache/", "__pycache__/"]
            # Resolve common output directories before a compiler creates and
            # removes them; deleted directories lose their type for check-ignore.
            ignored.update(repo_paths(repo_git(self.root, ["check-ignore", "--stdin", "-z"], ("\0".join(candidates) + "\0").encode(), missing=True, deadline=deadline)))
            self.ignored = {os.path.join(self.root, path.rstrip("/")) for path in ignored if path.endswith("/")}
            seen = set()
            for root in [self.root, *self.metadata]:
                self._tree(root, deadline, seen)
            root_fd = repo_open_dir(self.root)
            try:
                for source in sorted(self.sources):
                    self._watch_source(root_fd, source, deadline)
            finally:
                os.close(root_fd)
            current = [(path, os.stat(path).st_dev, os.stat(path).st_ino) for path in [self.root, *self.metadata]]
            if self.identities != current or self.sources != {os.path.join(self.root, name) for name in repo_inventory(self.root, deadline)}:
                raise ValueError("Linux repository changed during watch setup")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _add(self, fd, path, directory, deadline):
        if len(self.watches) >= REPO_MAX_WATCHES or time.monotonic() >= deadline:
            raise ValueError("Linux repository watch setup exceeded its bound")
        self.watch_mounts.add(repo_watch_mount(fd, self.mounts))
        wd = self.libc.inotify_add_watch(self.fd, os.fsencode("/proc/self/fd/" + str(fd)), self._directory | (0x01000000 if directory else 0))
        if wd < 0:
            raise OSError(self._errno(), "Could not watch Linux repository entry")
        self.watches.setdefault(wd, set()).add(path)

    def _tracked(self, path):
        return path in self.sources or any(source.startswith(path + "/") for source in self.sources)

    def _metadata(self, path):
        return path == self.root + "/.git" or any(path == root or path.startswith(root + "/") for root in self.metadata)

    def _tree(self, path, deadline, seen, parent=None, name=None):
        if not self._metadata(path) and not self._tracked(path) and any(path == item or path.startswith(item + "/") for item in self.ignored):
            return
        fd = repo_open_dir(path) if parent is None else os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            info = os.fstat(fd)
            identity = (info.st_dev, info.st_ino)
            if identity in seen:
                return
            seen.add(identity)
            self._add(fd, path, True, deadline)
            with os.scandir(fd) as entries:
                for item in entries:
                    if time.monotonic() >= deadline:
                        raise ValueError("Linux repository watch setup timed out")
                    if item.is_dir(follow_symlinks=False):
                        self._tree(os.path.join(path, item.name), deadline, seen, fd, item.name)
        finally:
            os.close(fd)

    def _watch_source(self, root_fd, source, deadline):
        name = source[len(self.root) + 1:]
        parent = None
        try:
            parent = repo_open_parent(root_fd, name)
            fd = os.open(name.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return
        finally:
            if parent is not None:
                os.close(parent)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError("Linux repository contains a nonregular source entry")
            self._add(fd, source, False, deadline)
        finally:
            os.close(fd)

    def _events(self, raw):
        at = 0
        while at < len(raw):
            if at + self._event.size > len(raw):
                raise ValueError("Incomplete Linux repository watch event")
            wd, mask, _cookie, length = self._event.unpack_from(raw, at)
            at += self._event.size
            if at + length > len(raw):
                raise ValueError("Incomplete Linux repository watch name")
            name = raw[at:at + length].split(b"\0", 1)[0].decode("utf-8")
            at += length
            if mask & (0x00004000 | 0x00002000):
                raise ValueError("Linux repository watcher lost events or its filesystem")
            if wd not in self.watches or "/" in name or name in (".", ".."):
                raise ValueError("Linux repository watcher returned an unknown path")
            if mask & 0x00008000:
                # A removed watch represents an inode deletion, which already
                # invalidates the check. Never report a match after losing it.
                self.changed_forever = True
            for parent in self.watches[wd]:
                path = os.path.join(parent, name) if name else parent
                if len(self.paths) >= REPO_MAX_PATHS and path not in self.paths:
                    raise ValueError("Linux repository changes exceeded watcher coverage")
                self.paths.add(path)

    def changed(self):
        if self.error:
            raise ValueError(self.error)
        try:
            if self.fd < 0:
                raise ValueError("Linux repository watcher is closed")
            mounts = repo_mount_table()
            if any(mounts.get(identity) != self.mounts[identity] for identity in self.watch_mounts):
                raise ValueError("Linux verification mount configuration changed")
            deadline = time.monotonic() + REPO_TIMEOUT
            while True:
                try:
                    raw = os.read(self.fd, 65536)
                except BlockingIOError:
                    break
                if not raw or time.monotonic() >= deadline:
                    raise ValueError("Linux repository event draining exceeded its coverage")
                self._events(raw)
            unknown = []
            for path in self.paths:
                if self._tracked(path) or self._metadata(path) or path == self.root or os.path.basename(path) == ".gitignore":
                    self.changed_forever = True
                elif any(path == item or path.startswith(item + "/") for item in self.ignored):
                    continue
                elif path.startswith(self.root + "/"):
                    unknown.append(path[len(self.root) + 1:])
                else:
                    raise ValueError("Linux watcher reported a path outside the repository")
            if unknown:
                data = ("\0".join(unknown) + "\0").encode("utf-8")
                ignored = repo_paths(repo_git(self.root, ["check-ignore", "--stdin", "-z"], data, missing=True, deadline=deadline))
                if any(path not in ignored for path in unknown):
                    self.changed_forever = True
            return self.changed_forever
        except Exception as error:
            self.error = str(error)
            raise
