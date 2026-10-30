"""qterm's fixed WSL data bridge. JSON is data; no caller supplies Python/shell code."""
import json
import os
import pwd
import re
import resource
import signal
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


def main(request):
    method = request.get("method")
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
    raw = sys.stdin.buffer.read(1_048_577)
    if len(raw) > 1_048_576:
        raise ValueError("WSL data request exceeds 1 MiB")
    result = {"result": main(json.loads(raw))}
except Exception as error:
    result = {"error": str(error)[:4000]}
print(json.dumps(result, ensure_ascii=True))
