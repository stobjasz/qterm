"""Real Linux definition, canonical-path and descriptor checks; no project runs."""
import pathlib
import shutil
import tempfile
import unittest


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fixture = pathlib.Path(tempfile.mkdtemp(prefix="qterm-wsl-workflows-"))
        self.root = self.fixture / "Case it's 🦀"
        self.root.mkdir()
        (self.root / "child").mkdir()
        (self.root / "Child").mkdir()
        self.file = self.root / ".qterm.toml"
        self.text = 'name = "literal $(touch must-not-run) 🦀"\n'
        self.file.write_text(self.text, encoding="utf-8")

    def tearDown(self):
        target = self.fixture.resolve()
        assert target == self.fixture and target.parent == pathlib.Path("/tmp") and target.name.startswith("qterm-wsl-workflows-")
        shutil.rmtree(target)

    def source(self, cwd=None):
        return workflow_source({"cwd": str(cwd or self.root)})

    def review(self, paths=None):
        source = self.source()
        directories = workflow_directories({"source": source, "paths": paths or [".", "child"]})
        return {"source": source, "directories": directories}

    def test_nearest_non_git_source_preserves_unicode_literal_bytes_and_linux_case(self):
        source = self.source(self.root / "child")
        self.assertEqual(source["text"], self.text)
        self.assertEqual(source["digest"], hashlib.sha256(self.text.encode()).hexdigest())
        self.assertEqual(source["project"], str(self.root))
        self.assertEqual(source["sourceIdentity"], workflow_identity(self.file.stat()))
        paths = workflow_directories({"source": source, "paths": ["child", "Child"]})
        self.assertNotEqual(paths[0]["identity"], paths[1]["identity"])
        self.assertEqual([item["directory"] for item in paths], [str(self.root / "child"), str(self.root / "Child")])
        (self.root / "child" / ".qterm.toml").write_text('name = "nearest"\n')
        self.assertEqual(self.source(self.root / "child")["project"], str(self.root / "child"))
        self.assertFalse((self.root / "must-not-run").exists())

    def test_changed_source_bytes_invalidate_review(self):
        review = self.review()
        self.file.write_text('name = "changed"\n')
        with self.assertRaisesRegex(ValueError, "source or project changed"):
            workflow_validate(review)

    def test_identical_source_replacement_invalidates_review(self):
        review = self.review()
        replacement = self.root / "new.toml"
        replacement.write_text(self.text, encoding="utf-8")
        replacement.replace(self.file)
        with self.assertRaisesRegex(ValueError, "source or project changed"):
            workflow_validate(review)

    def test_identical_project_replacement_invalidates_review(self):
        review = self.review()
        old = self.fixture / "old"
        self.root.rename(old)
        shutil.copytree(old, self.root)
        with self.assertRaisesRegex(ValueError, "source or project changed"):
            workflow_validate(review)

    def test_replaced_step_and_redirected_alias_invalidate_review(self):
        review = self.review()
        (self.root / "child").rename(self.root / "old-child")
        (self.root / "child").mkdir()
        with self.assertRaisesRegex(ValueError, "step folder changed"):
            workflow_validate(review)
        alias = self.root / "alias"
        alias.symlink_to("child", target_is_directory=True)
        review = self.review(["alias"])
        self.assertEqual(review["directories"][0]["directory"], str(self.root / "child"))
        alias.unlink()
        alias.symlink_to("Child", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "step folder changed"):
            workflow_validate(review)

    def test_source_alias_is_contained_and_special_files_never_block(self):
        target = self.root / "workflow.toml"
        self.file.rename(target)
        self.file.symlink_to("workflow.toml")
        self.assertEqual(self.source()["source"], str(target))
        self.file.unlink()
        outside = self.fixture / "outside.toml"
        outside.write_text(self.text, encoding="utf-8")
        self.file.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "source escapes"):
            self.source()
        self.file.unlink()
        os.mkfifo(self.file, 0o600)
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.source()
        self.file.unlink()
        self.file.mkdir()
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.source()

    def test_step_containment_uses_real_paths_and_component_boundaries(self):
        outside = self.fixture / (self.root.name + "-other")
        outside.mkdir()
        (self.root / "escape").symlink_to(outside, target_is_directory=True)
        source = self.source()
        with self.assertRaisesRegex(ValueError, "escapes the project"):
            workflow_directories({"source": source, "paths": ["escape"]})
        # A backslash is a literal Linux filename character, not a separator.
        literal = self.root / "literal\\folder"
        literal.mkdir()
        paths = workflow_directories({"source": source, "paths": [literal.name]})
        self.assertEqual(paths[0]["directory"], str(literal))
        for relative in ("../", "child/../Child", "/tmp", "bad\nname", ""):
            with self.assertRaisesRegex(ValueError, "project-relative"):
                workflow_directories({"source": source, "paths": [relative]})

    def test_bounds_and_invalid_encoding_are_explicit(self):
        source = self.source()
        for paths in ([], ["."] * 257, "child"):
            with self.assertRaisesRegex(ValueError, "1–256"):
                workflow_directories({"source": source, "paths": paths})
        self.file.write_bytes(b"x" * (WORKFLOW_MAX_SOURCE + 1))
        with self.assertRaisesRegex(ValueError, "256 KiB"):
            self.source()
        self.file.write_bytes(b"\xff")
        with self.assertRaises(UnicodeDecodeError):
            self.source()
        with self.assertRaisesRegex(ValueError, "deadline"):
            workflow_source({"cwd": str(self.root)}, time.monotonic() - 1)

    def test_repeated_failed_reads_release_all_descriptors(self):
        self.file.unlink()
        os.mkfifo(self.file, 0o600)
        before = len(os.listdir("/proc/self/fd"))
        for _ in range(32):
            with self.assertRaisesRegex(ValueError, "regular file"):
                self.source()
        self.assertEqual(len(os.listdir("/proc/self/fd")), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
