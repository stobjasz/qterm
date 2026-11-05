"""Real Linux project/manifest scope checks; no project tools execute."""
import copy
import pathlib
import shutil
import tempfile
import unittest


class TaskSourceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = pathlib.Path(tempfile.mkdtemp(prefix="qterm-wsl-task-sources-"))
        self.root = self.fixture / "Case it's 🦀"
        self.root.mkdir()
        self.child = self.root / "..\\literal"
        self.child.mkdir()
        repo_git(str(self.root), ["-c", "init.templateDir=", "init", "--quiet"])
        self.package = self.root / "package.json"
        self.package.write_text('{"scripts":{"check":"touch must-not-run; echo literal 🦀"}}', encoding="utf-8")
        self.context = task_project({"cwd": str(self.child)})

    def tearDown(self):
        target = self.fixture.resolve()
        assert target == self.fixture and target.parent == pathlib.Path("/tmp") and target.name.startswith("qterm-wsl-task-sources-")
        shutil.rmtree(target)

    def directory(self, path=None):
        return task_directory({"project": self.context["project"], "directory": str(path or self.root)})

    def read(self, snapshot, name="package.json"):
        return task_source({"project": self.context["project"], "directory": snapshot["directory"], "name": name, "expected": snapshot["files"][name]})

    def test_project_and_parent_facts_preserve_linux_paths_and_do_not_execute_scripts(self):
        self.assertEqual(self.context["project"]["path"], str(self.root))
        self.assertEqual(self.context["project"]["uid"], os.getuid())
        self.assertEqual(self.context["directory"]["path"], str(self.child))
        child = self.directory(self.child)
        self.assertEqual(child["parent"]["path"], str(self.root))
        root = self.directory()
        self.assertIsNone(root["parent"])
        result = self.read(root)
        self.assertEqual(base64.b64decode(result["base64"]), self.package.read_bytes())
        self.assertEqual(result["file"]["digest"], hashlib.sha256(self.package.read_bytes()).hexdigest())
        self.assertFalse((self.root / "must-not-run").exists())

    def test_changed_user_or_project_identity_cannot_reuse_the_context(self):
        foreign = copy.deepcopy(self.context["project"])
        foreign["uid"] += 1
        with self.assertRaisesRegex(ValueError, "project user changed"):
            task_directory({"project": foreign, "directory": str(self.root)})
        old = self.fixture / "old"
        self.root.rename(old)
        shutil.copytree(old, self.root)
        with self.assertRaisesRegex(ValueError, "project or Git metadata changed"):
            self.directory()

    def test_replaced_git_metadata_invalidates_the_context(self):
        old = self.root / "old-git"
        (self.root / ".git").rename(old)
        shutil.copytree(old, self.root / ".git")
        with self.assertRaisesRegex(ValueError, "project or Git metadata changed"):
            self.directory()

    def test_changed_or_identically_replaced_manifest_cannot_match_reviewed_facts(self):
        snapshot = self.directory()
        original = self.package.read_bytes()
        self.package.write_bytes(original.replace(b"literal", b"changed"))
        with self.assertRaisesRegex(ValueError, "manifest changed"):
            self.read(snapshot)
        self.package.write_bytes(original)
        replacement = self.root / "replacement.json"
        replacement.write_bytes(original)
        replacement.replace(self.package)
        with self.assertRaisesRegex(ValueError, "manifest changed"):
            self.read(snapshot)

    def test_replaced_directory_and_project_sibling_are_not_the_original_scope(self):
        snapshot = self.directory(self.child)
        self.child.rename(self.root / "old-child")
        self.child.mkdir()
        with self.assertRaisesRegex(ValueError, "task folder changed"):
            task_directory({"project": self.context["project"], "directory": snapshot["directory"]})
        sibling = self.fixture / (self.root.name + "-other")
        sibling.mkdir()
        with self.assertRaisesRegex(ValueError, "escapes the granted"):
            self.directory(sibling)

    def test_internal_manifest_aliases_work_and_external_aliases_are_rejected(self):
        target = self.root / "source.json"
        self.package.rename(target)
        self.package.symlink_to(target.name)
        snapshot = self.directory()
        self.assertEqual(snapshot["files"]["package.json"]["path"], str(target))
        self.assertEqual(base64.b64decode(self.read(snapshot)["base64"]), target.read_bytes())
        outside = self.fixture / "outside.json"
        outside.write_text('{"scripts":{"outside":"forbidden"}}')
        self.package.unlink()
        self.package.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "source escapes"):
            self.directory()

    def test_locks_are_presence_inputs_and_parent_selection_stops_at_project_root(self):
        (self.root / "pnpm-lock.yaml").write_text("one")
        (self.root / "yarn.lock").write_text("two")
        (self.fixture / "bun.lock").write_text("outside project")
        first = self.directory()
        self.assertEqual(first["locks"], ["pnpm-lock.yaml", "yarn.lock"])
        (self.root / "pnpm-lock.yaml").write_text("ordinary dependency update")
        self.assertEqual(self.directory()["locks"], first["locks"])
        (self.root / "pnpm-lock.yaml").unlink()
        self.assertEqual(self.directory()["locks"], ["yarn.lock"])

    def test_binary_sources_are_bounded_and_special_files_never_block(self):
        binary = self.root / "Cargo.toml"
        binary.write_bytes(b"\xff" * TASK_MAX_FILE)
        snapshot = self.directory()
        self.assertEqual(base64.b64decode(self.read(snapshot, "Cargo.toml")["base64"]), binary.read_bytes())
        binary.write_bytes(b"x" * (TASK_MAX_FILE + 1))
        snapshot = self.directory()
        self.assertTrue(snapshot["files"]["Cargo.toml"]["regular"])
        self.assertIsNone(snapshot["files"]["Cargo.toml"]["digest"])
        with self.assertRaisesRegex(ValueError, "at most 1 MiB"):
            self.read(snapshot, "Cargo.toml")
        binary.unlink()
        os.mkfifo(binary, 0o600)
        snapshot = self.directory()
        self.assertFalse(snapshot["files"]["Cargo.toml"]["regular"])
        before = len(os.listdir("/proc/self/fd"))
        for _ in range(16):
            with self.assertRaisesRegex(ValueError, "regular file"):
                self.read(snapshot, "Cargo.toml")
        self.assertEqual(len(os.listdir("/proc/self/fd")), before)

    def test_unknown_filenames_and_expired_reads_never_return_data(self):
        snapshot = self.directory()
        for name in ("../package.json", "/etc/passwd", "unknown.txt"):
            with self.assertRaisesRegex(ValueError, "known task manifests"):
                task_source({"project": self.context["project"], "directory": snapshot["directory"], "name": name, "expected": None})
        with self.assertRaisesRegex(ValueError, "deadline"):
            task_project({"cwd": str(self.root)}, time.monotonic() - 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
