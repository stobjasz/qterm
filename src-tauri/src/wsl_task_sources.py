"""Bounded, project-contained filesystem facts for named-task policies.

The bundled Rust parser owns task formats and command construction. These fixed
operations never run a package manager, Make, project script or shell command.
"""
import base64
import hashlib
import os
import stat
import time

TASK_MANIFESTS = ("package.json", "Cargo.toml", "Makefile", "makefile", "GNUmakefile",
                  "justfile", "Justfile", ".justfile", "composer.json", "pyproject.toml")
TASK_LOCKS = ("pnpm-lock.yaml", "yarn.lock", "bun.lock", "package-lock.json", "bun.lockb", "uv.lock", "poetry.lock")
TASK_MAX_FILE = 1_048_576


def task_project(request, deadline=None):
    deadline = time.monotonic() + 10 if deadline is None else deadline
    cwd, cwd_identity = workflow_directory(request["cwd"])
    root, metadata = repo_context(cwd, deadline)
    if os.path.commonpath((root, cwd)) != root:
        raise ValueError("Task folder escapes its Linux repository")
    project = {"path": root, "identity": workflow_directory(root)[1], "uid": os.getuid(),
               "metadata": [{"path": path, "identity": workflow_directory(path)[1]} for path in metadata]}
    workflow_deadline(deadline)
    return {"project": project, "directory": {"path": cwd, "identity": cwd_identity}}


def task_validate_project(expected, deadline):
    if not isinstance(expected, dict) or expected.get("uid") != os.getuid():
        raise ValueError("The reviewed Linux project user changed")
    actual = task_project({"cwd": expected["path"]}, deadline)["project"]
    if actual != expected:
        raise ValueError("The reviewed Linux project or Git metadata changed")
    return actual


def task_directory_identity(project, value):
    path, identity = workflow_directory(value["path"] if isinstance(value, dict) else value)
    if os.path.commonpath((project["path"], path)) != project["path"]:
        raise ValueError("Task folder escapes the granted Linux project")
    actual = {"path": path, "identity": identity}
    if isinstance(value, dict) and value != actual:
        raise ValueError("The reviewed Linux task folder changed")
    return actual


def task_file(project, directory, name, deadline, content=False):
    workflow_deadline(deadline)
    if name not in TASK_MANIFESTS + TASK_LOCKS:
        raise ValueError("Unknown named-task source file")
    candidate = os.path.join(directory["path"], name)
    if not os.path.lexists(candidate):
        return None
    canonical = os.path.realpath(candidate, strict=True)
    if os.path.commonpath((project["path"], canonical)) != project["path"]:
        raise ValueError("Task source escapes the granted Linux project")
    root_fd = repo_open_dir(project["path"])
    parent = fd = None
    try:
        if workflow_identity(os.fstat(root_fd)) != project["identity"]:
            raise ValueError("The reviewed Linux project changed")
        relative = os.path.relpath(canonical, project["path"])
        parent = repo_open_parent(root_fd, relative)
        fd = os.open(os.path.basename(canonical), os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        before = os.fstat(fd)
        regular = stat.S_ISREG(before.st_mode)
        fact = {"name": name, "path": canonical, "identity": workflow_identity(before),
                "regular": regular, "size": before.st_size, "digest": None}
        data = b""
        if content and (not regular or before.st_size > TASK_MAX_FILE):
            raise ValueError("Task source must be a regular file of at most 1 MiB")
        if regular and name in TASK_MANIFESTS and before.st_size <= TASK_MAX_FILE:
            chunks, size = [], 0
            while True:
                workflow_deadline(deadline)
                chunk = os.read(fd, min(65536, TASK_MAX_FILE + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > TASK_MAX_FILE:
                    raise ValueError("Task source exceeds 1 MiB")
                chunks.append(chunk)
            data = b"".join(chunks)
            fact["digest"] = hashlib.sha256(data).hexdigest()
        if (workflow_signature(os.fstat(fd)) != workflow_signature(before)
                or workflow_signature(os.stat(canonical, follow_symlinks=False)) != workflow_signature(before)
                or os.path.realpath(candidate, strict=True) != canonical):
            raise ValueError("Task source changed during inspection")
        workflow_deadline(deadline)
        return (fact, data) if content else fact
    finally:
        if fd is not None:
            os.close(fd)
        if parent is not None:
            os.close(parent)
        os.close(root_fd)


def task_directory(request):
    deadline = time.monotonic() + 10
    project = task_validate_project(request["project"], deadline)
    directory = task_directory_identity(project, request["directory"])
    files = {} if request.get("locksOnly") is True else {name: task_file(project, directory, name, deadline) for name in TASK_MANIFESTS}
    locks = [name for name in TASK_LOCKS if (fact := task_file(project, directory, name, deadline)) and fact["regular"]]
    parent = None
    if directory["path"] != project["path"]:
        parent = task_directory_identity(project, os.path.dirname(directory["path"]))
    task_validate_project(project, deadline)
    task_directory_identity(project, directory)
    return {"directory": directory, "files": files, "locks": locks, "parent": parent}


def task_source(request):
    deadline = time.monotonic() + 10
    project = task_validate_project(request["project"], deadline)
    directory = task_directory_identity(project, request["directory"])
    name = request["name"]
    if name not in TASK_MANIFESTS:
        raise ValueError("Only known task manifests can be read")
    result = task_file(project, directory, name, deadline, True)
    if result is None or result[0] != request["expected"]:
        raise ValueError("The reviewed Linux task manifest changed")
    fact, data = result
    task_validate_project(project, deadline)
    task_directory_identity(project, directory)
    return {"file": fact, "base64": base64.b64encode(data).decode("ascii")}


def task_scope_paths(request):
    deadline = time.monotonic() + 10
    project = task_validate_project(request["project"], deadline)
    paths = request["paths"]
    if not isinstance(paths, list) or len(paths) > 256:
        raise ValueError("At most 256 scoped task folders are allowed")
    result = []
    for path in paths:
        workflow_deadline(deadline)
        try:
            canonical = repo_folder(path)
            result.append(os.path.commonpath((project["path"], canonical)) == project["path"])
        except (OSError, ValueError):
            result.append(False)
    task_validate_project(project, deadline)
    return result
