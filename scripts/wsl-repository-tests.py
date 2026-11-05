"""Real Linux Git/files/inotify checks, loaded with the bundled module by Node."""
import pathlib
import shutil
import unittest


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = pathlib.Path(tempfile.mkdtemp(prefix="qterm-wsl-verification-"))
        self.root = self.fixture / "Case source"
        self.root.mkdir()
        (self.root / "src").mkdir()
        self.file = self.root / "src" / "Value.txt"
        self.file.write_text("one", encoding="utf-8")
        (self.root / ".gitignore").write_text("target/\nignored.txt\n*.log\n", encoding="utf-8")
        self.git("init", "--quiet", "--initial-branch=source")
        self.git("config", "user.name", "fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("add", ".")
        self.git("-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "fixture")

    def tearDown(self):
        resolved = self.fixture.resolve()
        assert resolved == self.fixture and resolved.parent == pathlib.Path("/tmp") and resolved.name.startswith("qterm-wsl-verification-")
        shutil.rmtree(resolved)

    def git(self, *args, cwd=None):
        return repo_git(str(cwd or self.root), list(args))

    def test_stable_snapshots_capture_actual_bytes_index_head_and_executable_mode(self):
        first = repository_capture(str(self.root))
        self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.assertEqual(first["files"], 2)
        self.assertEqual(first["branch"], "refs/heads/source")
        self.assertEqual(first["root"], str(self.root))
        self.file.write_text("two", encoding="utf-8")
        self.assertNotEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.file.write_text("one", encoding="utf-8")
        self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.file.chmod(0o755)
        self.assertNotEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.file.chmod(0o644)
        self.file.write_text("staged", encoding="utf-8")
        self.git("add", ".")
        self.file.write_text("one", encoding="utf-8")
        self.assertNotEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.git("reset", "--quiet", "HEAD", "--")
        self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
        self.git("-c", "commit.gpgSign=false", "commit", "--allow-empty", "--quiet", "-m", "identity-only")
        advanced = repository_capture(str(self.root))
        self.assertNotEqual(first["head"], advanced["head"])
        self.assertNotEqual(first["digest"], advanced["digest"])
        self.git("branch", "alternate")
        self.git("symbolic-ref", "HEAD", "refs/heads/alternate")
        alternate = repository_capture(str(self.root))
        self.assertEqual(alternate["head"], advanced["head"])
        self.assertNotEqual(alternate["digest"], advanced["digest"])

    def test_changed_then_restored_content_stays_invalidated(self):
        with RepositoryCoverage(str(self.root)) as coverage:
            first = repository_capture(str(self.root))
            self.assertFalse(coverage.changed())
            self.file.write_text("intervening content", encoding="utf-8")
            self.file.write_text("one", encoding="utf-8")
            self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertTrue(coverage.changed())
            self.assertTrue(coverage.changed())

    def test_ignored_output_does_not_hide_new_source_or_ignore_rule_edits(self):
        with RepositoryCoverage(str(self.root)) as coverage:
            first = repository_capture(str(self.root))
            (self.root / "target").mkdir()
            (self.root / "target" / "temporary").write_text("output")
            shutil.rmtree(self.root / "target")
            self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertFalse(coverage.changed())
        (self.root / "target").mkdir()
        with RepositoryCoverage(str(self.root)) as coverage:
            first = repository_capture(str(self.root))
            (self.root / "target" / "artifact").write_text("output")
            (self.root / "ignored.txt").write_text("output")
            (self.root / "build.log").write_text("output")
            self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertFalse(coverage.changed())
            source = self.root / "Case.py"
            source.write_text("temporary source")
            source.unlink()
            self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertTrue(coverage.changed())
        with RepositoryCoverage(str(self.root)) as coverage:
            (self.root / ".gitignore").write_text("*\n")
            self.assertTrue(coverage.changed())

    def test_hardlink_writes_and_atomic_editor_replacements_are_observed(self):
        alias = self.fixture / "external-alias"
        os.link(self.file, alias)
        with RepositoryCoverage(str(self.root)) as coverage:
            first = repository_capture(str(self.root))
            alias.write_text("outside write")
            alias.write_text("one")
            self.assertEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertTrue(coverage.changed())
        with RepositoryCoverage(str(self.root)) as coverage:
            new = self.root / "src" / "replacement"
            new.write_text("one")
            new.replace(self.file)
            self.assertTrue(coverage.changed())

    def test_linked_worktree_watches_shared_git_metadata(self):
        task = self.fixture / "Task"
        self.git("worktree", "add", "--quiet", "-b", "task", str(task))
        with RepositoryCoverage(str(task)) as coverage:
            first = repository_capture(str(task))
            self.assertFalse(coverage.changed())
            self.git("update-ref", "refs/heads/unrelated", "HEAD")
            self.assertEqual(first["digest"], repository_capture(str(task))["digest"])
            self.assertTrue(coverage.changed())

    def test_repository_replacement_missing_files_and_nonregular_entries(self):
        first = repository_capture(str(self.root))
        self.file.unlink()
        self.assertNotEqual(first["digest"], repository_capture(str(self.root))["digest"])
        os.symlink(str(self.fixture / "outside"), self.file)
        with self.assertRaises(OSError):
            repository_capture(str(self.root))
        with self.assertRaises(OSError):
            RepositoryCoverage(str(self.root))
        self.file.unlink()
        os.mkfifo(self.file)
        with self.assertRaisesRegex(ValueError, "regular file"):
            repository_capture(str(self.root))
        self.file.unlink()
        self.file.write_text("one")
        outside = self.fixture / "outside-directory"
        (self.root / "src").rename(outside)
        os.symlink(outside, self.root / "src")
        with self.assertRaises(OSError):
            repository_capture(str(self.root))
        with self.assertRaises(OSError):
            RepositoryCoverage(str(self.root))
        self.assertEqual((outside / "Value.txt").read_text(), "one")
        (self.root / "src").unlink()
        outside.rename(self.root / "src")
        replacement = self.fixture / "replacement"
        with RepositoryCoverage(str(self.root)) as coverage:
            self.root.rename(replacement)
            shutil.copytree(replacement, self.root)
            self.assertNotEqual(first["digest"], repository_capture(str(self.root))["digest"])
            self.assertTrue(coverage.changed())

    def test_watcher_failure_and_limits_never_report_unchanged(self):
        with RepositoryCoverage(str(self.root)) as coverage:
            with self.assertRaises(OSError):
                coverage._add(-1, str(self.file), False, time.monotonic() + 1)
            coverage.close()
            with self.assertRaisesRegex(ValueError, "closed"):
                coverage.changed()
            with self.assertRaisesRegex(ValueError, "closed"):
                coverage.changed()
        original = globals()["REPO_MAX_PATHS"]
        try:
            globals()["REPO_MAX_PATHS"] = 1
            with RepositoryCoverage(str(self.root)) as coverage:
                (self.root / "new-a").write_text("a")
                (self.root / "new-b").write_text("b")
                with self.assertRaisesRegex(ValueError, "exceeded watcher coverage"):
                    coverage.changed()
        finally:
            globals()["REPO_MAX_PATHS"] = original
        original = globals()["REPO_MAX_BYTES"]
        try:
            globals()["REPO_MAX_BYTES"] = 1
            with self.assertRaisesRegex(ValueError, "exceeds 128 MiB"):
                repository_capture(str(self.root))
        finally:
            globals()["REPO_MAX_BYTES"] = original
        for setting, value, message in (("REPO_MAX_FILES", 1, "20000 files"), ("REPO_TIMEOUT", -1, "deadline")):
            original = globals()[setting]
            try:
                globals()[setting] = value
                with self.assertRaisesRegex(ValueError, message):
                    repository_capture(str(self.root))
            finally:
                globals()[setting] = original
        original = globals()["REPO_MAX_WATCHES"]
        before = len(os.listdir("/proc/self/fd"))
        try:
            globals()["REPO_MAX_WATCHES"] = 0
            for _ in range(4):
                with self.assertRaisesRegex(ValueError, "watch setup exceeded"):
                    RepositoryCoverage(str(self.root))
            self.assertEqual(len(os.listdir("/proc/self/fd")), before)
        finally:
            globals()["REPO_MAX_WATCHES"] = original

    def test_real_kernel_queue_overflow_is_a_sticky_error(self):
        limit = int(pathlib.Path("/proc/sys/fs/inotify/max_queued_events").read_text())
        if limit > 65536:
            self.skipTest("Kernel queue above bounded fixture workload")
        with RepositoryCoverage(str(self.root)) as coverage:
            path = self.root / "ignored.txt"
            for _ in range(limit + 32):
                path.touch()
                path.unlink()
            with self.assertRaisesRegex(ValueError, "lost events"):
                coverage.changed()
            with self.assertRaisesRegex(ValueError, "lost events"):
                coverage.changed()

    def test_hostile_repository_configuration_is_not_executed(self):
        script = self.fixture / "forbidden.sh"
        marker = self.fixture / "executed"
        script.write_text("#!/bin/sh\ntouch '" + str(marker) + "'\ncat\n")
        script.chmod(0o700)
        self.git("config", "core.fsmonitor", str(script))
        self.git("config", "diff.external", str(script))
        for setting in ("clean", "smudge", "process"):
            self.git("config", "filter.trip." + setting, str(script))
        self.git("config", "filter.trip.required", "true")
        (self.root / ".gitattributes").write_text("src/Value.txt filter=trip diff=trip\n")
        for hook in ("post-checkout", "reference-transaction"):
            os.symlink(script, self.root / ".git" / "hooks" / hook)
        with RepositoryCoverage(str(self.root)) as coverage:
            repository_capture(str(self.root))
            self.assertFalse(coverage.changed())
        self.assertFalse(marker.exists())


unittest.main(argv=["wsl-repository-tests"], verbosity=2)
