"""Fixed, bounded Linux workflow definition reads and identity revalidation.

No project code is imported or executed. Rust owns TOML parsing and launch
authorization; this module only supplies bytes and canonical filesystem facts.
"""
import hashlib
import os
import stat
import time

WORKFLOW_MAX_SOURCE = 262_144
WORKFLOW_MAX_DIRECTORIES = 256


def workflow_deadline(deadline):
    if time.monotonic() >= deadline:
        raise ValueError("Linux workflow inspection exceeded its deadline")


def workflow_identity(info):
    return [info.st_dev, info.st_ino]


def workflow_signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def workflow_directory(value):
    canonical = repo_folder(value)
    fd = repo_open_dir(canonical)
    try:
        identity = workflow_identity(os.fstat(fd))
        if workflow_identity(os.stat(canonical)) != identity or repo_folder(value) != canonical:
            raise ValueError("Linux workflow folder changed during inspection")
        return canonical, identity
    finally:
        os.close(fd)


def workflow_source(request, deadline=None):
    deadline = time.monotonic() + 10 if deadline is None else deadline
    root = repo_folder(request["cwd"])
    for _ in range(256):
        workflow_deadline(deadline)
        if os.path.lexists(os.path.join(root, ".qterm.toml")):
            break
        parent = os.path.dirname(root)
        if parent == root:
            raise ValueError("No .qterm.toml found")
        root = parent
    else:
        raise ValueError("Linux workflow ancestor search exceeded its bound")
    root_fd = repo_open_dir(root)
    try:
        root_identity = workflow_identity(os.fstat(root_fd))
        source = os.path.realpath(os.path.join(root, ".qterm.toml"), strict=True)
        if os.path.dirname(source) != root:
            raise ValueError("Workflow source escapes its project folder")
        source_fd = os.open(os.path.basename(source), os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
        try:
            before = os.fstat(source_fd)
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Workflow source must be a regular file")
            if before.st_size > WORKFLOW_MAX_SOURCE:
                raise ValueError("Workflow source exceeds 256 KiB")
            chunks, size = [], 0
            while True:
                workflow_deadline(deadline)
                chunk = os.read(source_fd, min(65536, WORKFLOW_MAX_SOURCE + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > WORKFLOW_MAX_SOURCE:
                    raise ValueError("Workflow source exceeds 256 KiB")
                chunks.append(chunk)
            if workflow_signature(os.fstat(source_fd)) != workflow_signature(before):
                raise ValueError("Workflow source changed during inspection")
            content = b"".join(chunks)
            source_identity = workflow_identity(before)
        finally:
            os.close(source_fd)
        if (workflow_identity(os.stat(root)) != root_identity
                or os.path.realpath(os.path.join(root, ".qterm.toml"), strict=True) != source
                or workflow_signature(os.stat(source, follow_symlinks=False)) != workflow_signature(before)):
            raise ValueError("Workflow source or project changed during inspection")
        workflow_deadline(deadline)
        return {"project": root, "source": source, "projectIdentity": root_identity,
                "sourceIdentity": source_identity, "digest": hashlib.sha256(content).hexdigest(),
                "text": content.decode("utf-8")}
    finally:
        os.close(root_fd)


def workflow_expected(expected, deadline):
    if not isinstance(expected, dict):
        raise ValueError("Expected a reviewed Linux workflow source")
    actual = workflow_source({"cwd": expected["project"]}, deadline)
    fields = ("project", "source", "projectIdentity", "sourceIdentity", "digest")
    if any(actual[field] != expected.get(field) for field in fields):
        raise ValueError("Reviewed Linux workflow source or project changed; review again")
    return actual


def workflow_step(root, relative, deadline):
    workflow_deadline(deadline)
    if (not isinstance(relative, str) or not relative or len(relative) > 4096
            or relative.startswith("/") or ".." in relative.split("/")
            or any(ord(char) < 32 for char in relative)):
        raise ValueError("Workflow cwd must be project-relative without parent traversal")
    directory, identity = workflow_directory(os.path.join(root, relative))
    if os.path.commonpath((root, directory)) != root:
        raise ValueError("Workflow step folder escapes the project")
    return {"relative": relative, "directory": directory, "identity": identity}


def workflow_directories(request):
    deadline = time.monotonic() + 10
    source = workflow_expected(request["source"], deadline)
    paths = request["paths"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= WORKFLOW_MAX_DIRECTORIES:
        raise ValueError("Expected 1–256 workflow step directories")
    directories = [workflow_step(source["project"], relative, deadline) for relative in paths]
    workflow_expected(source, deadline)
    for directory in directories:
        if workflow_step(source["project"], directory["relative"], deadline) != directory:
            raise ValueError("Workflow step folder changed during inspection")
    return directories


def workflow_validate(request):
    expected = request["directories"]
    if not isinstance(expected, list) or not 1 <= len(expected) <= WORKFLOW_MAX_DIRECTORIES:
        raise ValueError("Expected 1–256 reviewed workflow step directories")
    if any(not isinstance(directory, dict) for directory in expected):
        raise ValueError("Expected reviewed workflow step directories")
    directories = workflow_directories({"source": request["source"], "paths": [directory.get("relative") for directory in expected]})
    if directories != expected:
        raise ValueError("Reviewed Linux workflow step folder changed; review again")
    return {"valid": True}
