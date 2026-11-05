"""qterm's fixed WSL data bridge. JSON is data; no caller supplies Python/shell code."""
import json
import hashlib
import hmac
import os
import pwd
import re
import resource
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import uuid


def timeout(_signum, _frame):
    raise TimeoutError("WSL data operation exceeded its deadline")


signal.signal(signal.SIGALRM, timeout)
signal.alarm(20)


def path(value):
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096 or any(ord(c) < 32 for c in value):
        raise ValueError("Expected an absolute Linux path without control characters")
    return value


def folder(value):
    value = path(os.path.realpath(path(value), strict=True))
    if not os.path.isdir(value):
        raise ValueError("Linux folder is unavailable")
    return value


def git(cwd, args, extra=(), allow_missing=False):
    # Git's output uses private unlinked files, limited in the child. Avoid an
    # unbounded communicate() allocation or a blocked stdout/stderr pipe.
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (1_048_576, 1_048_576))

    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
    command = ["/usr/bin/git", "--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null", "-c", "submodule.recurse=false"]
    for setting in extra:
        command += ["-c", setting]
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        child = subprocess.Popen(command + args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True, preexec_fn=limits)
        try:
            code = child.wait(timeout=6)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        out.seek(0)
        output = out.read(1_048_577)
        err.seek(0)
        error = err.read(4096).decode("utf-8", "replace")
        if len(output) > 1_048_576 or code == -signal.SIGXFSZ:
            raise ValueError("WSL Git output exceeded 1 MiB")
        if code and not (allow_missing and code == 1):
            raise ValueError("WSL Git inspection failed: " + error[:2000])
        return output.decode("utf-8")


def project(cwd):
    cwd = folder(cwd)
    # No Git process outside an apparent repository.
    current = cwd
    while not os.path.exists(os.path.join(current, ".git")):
        parent = os.path.dirname(current)
        if parent == current:
            return {"cwd": cwd, "git": None}
        current = parent
    names = git(cwd, ["config", "--null", "--name-only", "--get-regexp", r"^filter\..*\.(clean|smudge|process|required)$"], allow_missing=True)
    disabled = []
    for name in names.split("\0"):
        if name:
            disabled.append(name + ("=false" if name.endswith(".required") else "="))
    return {"cwd": cwd, "git": git(cwd, ["status", "--porcelain=v2", "--branch", "--ignore-submodules=all"], disabled)}


def resolve(request):
    cwd = folder(request["cwd"])
    paths = request["paths"]
    if not isinstance(paths, list) or len(paths) > 256:
        raise ValueError("At most 256 file candidates are allowed")
    found = []
    for candidate in paths:
        if not isinstance(candidate, str) or not candidate or len(candidate) > 4096 or any(ord(c) < 32 for c in candidate) or re.match(r"^[a-zA-Z]:[\\/]", candidate) or candidate.startswith("\\"):
            found.append(None)
            continue
        candidate = os.path.realpath(os.path.join(cwd, candidate))
        found.append(candidate if os.path.isfile(candidate) else None)
    return found


def translate(request):
    paths = request["paths"]
    if not isinstance(paths, list) or not paths or len(paths) > 64:
        raise ValueError("Expected 1–64 absolute paths")
    to_linux = request["toLinux"]
    if not isinstance(to_linux, bool):
        raise ValueError("Invalid path translation direction")
    results = []
    for value in paths:
        if not isinstance(value, str) or not value or len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Invalid path for WSL translation")
        if to_linux:
            # Explorer can hand us another distro's UNC path. Never discard that
            # identity and reinterpret its tail in the destination distribution.
            unc = re.match(r"^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(\\.*)?$", value, re.I)
            if unc:
                if unc.group(1).lower() != request["distribution"].lower():
                    raise ValueError("This file belongs to another WSL distribution")
                result = (unc.group(2) or "\\").replace("\\", "/")
            elif re.match(r"^[a-zA-Z]:[\\/]", value) or value.startswith("\\\\"):
                result = wslpath(value, "-u")
            else:
                raise ValueError("Expected an absolute Windows drive or same-distribution UNC path")
            result = os.path.realpath(path(result), strict=True)
        else:
            value = os.path.realpath(path(value), strict=True)
            if any(c in value for c in '\\:<>"|?*') or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError("This Linux path cannot be represented safely as a Windows path")
            result = wslpath(value, "-w")
            if not (re.match(r"^[a-zA-Z]:[\\/]", result) or result.startswith("\\\\")):
                raise ValueError("WSL returned a nonabsolute Windows path")
        results.append(result)
    return results


def wslpath(value, direction):
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        child = subprocess.Popen(["/usr/bin/wslpath", direction, "-a", value], stdin=subprocess.DEVNULL, stdout=out, stderr=err)
        try:
            code = child.wait(timeout=3)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
        out.seek(0)
        result = out.read(16385)
        if code or len(result) > 16384:
            raise ValueError("WSL could not translate the path")
        return result.decode("utf-8").rstrip("\r\n")


def brief(text):
    if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > 131072:
        raise ValueError("An agent brief must contain 1–131072 UTF-8 bytes")
    root = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "qterm", "briefs")
    os.makedirs(root, mode=0o700, exist_ok=True)
    root = os.path.realpath(root)
    for index, item in enumerate(os.scandir(root)):
        if index >= 512:
            break
        if re.fullmatch(r"brief-[0-9a-f]{32}\.md", item.name) and item.is_file(follow_symlinks=False) and time.time() - item.stat(follow_symlinks=False).st_mtime > 7 * 86400:
            os.unlink(item.path)
    target = os.path.join(root, "brief-" + uuid.uuid4().hex + ".md")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
    except BaseException:
        os.unlink(target)
        raise
    return {"path": target}


def worktree_filters(cwd):
    names = git(cwd, ["config", "--null", "--name-only", "--get-regexp", r"^filter\..*\.(clean|smudge|process|required)$"], allow_missing=True)
    return [name + ("=false" if name.endswith(".required") else "=") for name in names.split("\0") if name]


def worktree_field(cwd, args):
    return git(cwd, args).rstrip("\r\n")


def worktree_commit(cwd, base):
    if not isinstance(base, str) or not base.strip() or len(base) > 500 or "\0" in base:
        raise ValueError("Expected a bounded literal base revision")
    return worktree_field(cwd, ["rev-parse", "--verify", "--end-of-options", base + "^{commit}"])


def worktree_repository(cwd):
    cwd = folder(cwd)
    root = folder(worktree_field(cwd, ["rev-parse", "--show-toplevel"]))
    common = folder(worktree_field(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
    return root, common


def worktree_identity(value):
    info = os.stat(value)
    return [info.st_dev, info.st_ino]


def worktree_destination(value, root, common):
    value = path(value)
    if any(part in (".", "..") for part in value.split("/")) or value.endswith("/"):
        raise ValueError("Choose an absolute new directory without dot components")
    parent, name = os.path.split(value)
    if not name:
        raise ValueError("A new directory name is required")
    parent = folder(parent)
    target = os.path.join(parent, name)
    if os.path.lexists(target):
        raise ValueError("The destination already exists; choose a new directory")
    if any(os.path.commonpath([target, boundary]) == boundary for boundary in (root, common)):
        raise ValueError("Choose a directory outside the source checkout and Git metadata")
    identity = os.stat(parent)
    return target, [identity.st_dev, identity.st_ino]


def worktree_preview(request):
    root, common = worktree_repository(request["cwd"])
    branch = request["branch"]
    if not isinstance(branch, str) or not branch or len(branch) > 240 or branch.startswith("-") or "\0" in branch:
        raise ValueError("Enter a literal new branch name")
    if worktree_field(root, ["check-ref-format", "--branch", branch]) != branch:
        raise ValueError("Enter a literal new branch name")
    if git(root, ["for-each-ref", "--format=%(refname)", "refs/heads/" + branch]):
        raise ValueError("That branch already exists; choose a new branch")
    target, parent_identity = worktree_destination(request["directory"], root, common)
    return {"repository": root, "commonDir": common, "directory": target,
            "sourceIdentity": worktree_identity(root), "commonIdentity": worktree_identity(common),
            "branch": branch, "base": request["base"], "commit": worktree_commit(root, request["base"]),
            "parentIdentity": parent_identity,
            "sourceDirty": bool(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"], worktree_filters(root)))}


def worktree_create(request):
    # Only backend-retained preview data may reach this operation; no generic Git
    # arguments, shell input, overwrite, rollback or cleanup operation is exposed.
    expected = request["preview"]
    current = worktree_preview({"cwd": expected["repository"], "directory": expected["directory"], "base": expected["base"], "branch": expected["branch"]})
    for key in ("repository", "commonDir", "sourceIdentity", "commonIdentity", "directory", "branch", "base", "commit", "parentIdentity"):
        if current[key] != expected[key]:
            raise ValueError("Repository, base or destination parent changed; review a new preview")
    target = current["directory"]
    # Pin the reviewed parent through reservation; mkdir is exclusive, including
    # dangling symlinks. Preserve the reservation and any partial Git state on error.
    parent = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        identity = os.fstat(parent)
        if [identity.st_dev, identity.st_ino] != current["parentIdentity"]:
            raise ValueError("Destination parent changed; review a new preview")
        os.mkdir(os.path.basename(target), dir_fd=parent)
        after = os.stat(os.path.dirname(target))
        if (after.st_dev, after.st_ino) != (identity.st_dev, identity.st_ino):
            raise ValueError("Destination parent changed after reservation; reserved directory was preserved")
        git(current["repository"], ["worktree", "add", "--no-checkout", "-b", current["branch"], "--", target, current["commit"]], ["core.symlinks=false"])
        actual_root, actual_common = worktree_repository(target)
        if actual_root != target or actual_common != current["commonDir"] or worktree_identity(actual_common) != current["commonIdentity"]:
            raise ValueError("The reserved directory is no longer the reviewed worktree")
        git(target, ["reset", "--hard", current["commit"], "--"], ["core.symlinks=false", *worktree_filters(target)])
    finally:
        os.close(parent)
    return {"directory": target}


def worktree_details(request):
    expected = request["task"]
    root, common = worktree_repository(expected["directory"])
    if root != expected["directory"] or common != expected["commonDir"] or worktree_identity(common) != expected["commonIdentity"]:
        raise ValueError("This directory is no longer the recorded worktree")
    # Match the text checkout policy without changing shared repository config.
    filters = ["core.symlinks=false", *worktree_filters(root)]
    entries = iter(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=all"], filters).split("\0"))
    changed, untracked = 0, 0
    for entry in entries:
        if not entry:
            continue
        if entry.startswith("??"):
            untracked += 1
        else:
            changed += 1
            if "R" in entry[:2] or "C" in entry[:2]:
                next(entries, None)
    commit = worktree_commit(root, expected["commit"])
    if commit != expected["commit"]:
        raise ValueError("The recorded task commit is invalid")
    summary = git(root, ["diff", "--no-ext-diff", "--no-textconv", "--stat", commit, "--"], filters).rstrip("\r\n")
    return {"branch": worktree_field(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
            "head": worktree_commit(root, "HEAD"), "changed": changed, "untracked": untracked,
            "commits": worktree_field(root, ["rev-list", "--count", commit + "..HEAD"]),
            "summary": summary[:12000], "summaryTruncated": len(summary) > 12000}


def main(request):
    method = request.get("method")
    if method == "repository_snapshot":
        return repository_capture(request["cwd"])
    if method == "verification_start":
        value = dict(request)
        value["lifetime"] = os.path.realpath(path(wslpath(request["lifetime"], "-u")), strict=True)
        return verification_start(value)
    if method == "verification_request":
        return verification_request(request)
    if method == "worktree_preview":
        return worktree_preview(request)
    if method == "worktree_create":
        return worktree_create(request)
    if method == "worktree_details":
        return worktree_details(request)
    if method == 'owner_presence':
        tokens = request['tokens']
        if not isinstance(tokens, list) or not 1 <= len(tokens) <= 4:
            raise ValueError('Expected one to four captured Linux owners')
        results = []
        for token in tokens:
            try:
                results.append({'providers': main({'method': 'owner', 'token': token, 'action': 'presence'})})
            except Exception as error:
                results.append({'error': str(error)[:2000]})
        return results
    if method == 'owner':
        token, action = request['token'], request['action']
        if not isinstance(token, str) or not re.fullmatch('[0-9a-f]{64}', token) or action not in ('programs', 'stop', 'presence', 'ready', 'launch', 'can_stop'):
            raise ValueError('Invalid Linux owner request')
        nonce = os.urandom(16).hex()
        expires = time.monotonic_ns() + 2_500_000_000
        proof = hmac.new(token.encode(), (nonce + '\n' + action + '\n' + str(expires)).encode(), hashlib.sha256).hexdigest()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3)
            client.connect('\0qterm-owner-' + hashlib.sha256(token.encode()).hexdigest())
            _, uid, _ = struct.unpack('3i', client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                raise ValueError('Linux supervisor user does not match this distribution user')
            client.sendall((json.dumps({'nonce': nonce, 'method': action, 'expires': expires, 'proof': proof}) + '\n').encode())
            raw = b''
            while b'\n' not in raw:
                chunk = client.recv(8192)
                if not chunk:
                    raise ValueError('Linux supervisor closed its response')
                raw += chunk
                if len(raw) > 4 * 1024 * 1024:
                    raise ValueError('Linux supervisor response exceeded its bound')
            envelope = json.loads(raw)
            expected = hmac.new(token.encode(), (nonce + '\n' + envelope['payload']).encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, envelope['proof']):
                raise ValueError('Linux supervisor response could not be authenticated')
            response = json.loads(envelope['payload'])
            if 'error' in response:
                raise ValueError(response['error'])
            return response['result']
    if method == "environment":
        home = os.path.expanduser("~")
        return {"home": home, "shell": pwd.getpwuid(os.getuid()).pw_shell, "claudeHome": os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "codexHome": os.environ.get("CODEX_HOME") or os.path.join(home, ".codex")}
    if method == "source_home":
        provider = request["provider"]
        if provider not in ("claude", "codex"):
            raise ValueError("Unknown transcript provider")
        default = os.environ.get("CLAUDE_CONFIG_DIR" if provider == "claude" else "CODEX_HOME") or os.path.expanduser("~/." + provider)
        home = os.path.realpath(path(request.get("override") or default))
        return {"home": home}
    if method == "folder":
        return {"cwd": folder(request["cwd"])}
    if method == "workflow_source":
        return workflow_source(request)
    if method == "task_project":
        return task_project(request)
    if method == "task_validate_project":
        task_validate_project(request["project"], time.monotonic() + 10)
        return {"valid": True}
    if method == "task_scope_paths":
        return task_scope_paths(request)
    if method == "task_directory":
        return task_directory(request)
    if method == "task_source":
        return task_source(request)
    if method == "workflow_directories":
        return workflow_directories(request)
    if method == "workflow_validate":
        return workflow_validate(request)
    if method == "project":
        return project(request["cwd"])
    if method == "resolve":
        return resolve(request)
    if method == "translate":
        return translate(request)
    if method == "brief":
        return brief(request["text"])
    raise ValueError("Unsupported WSL data operation")


try:
    if "QTERM_REQUEST" in globals():
        request = QTERM_REQUEST
    else:
        raw = sys.stdin.buffer.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("WSL data request exceeds 1 MiB")
        request = json.loads(raw)
    result = {"result": main(request)}
except Exception as error:
    result = {"error": str(error)[:4000]}
print(json.dumps(result, ensure_ascii=True))
