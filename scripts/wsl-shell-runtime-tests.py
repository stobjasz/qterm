"""Actual multi-call executable/argv evidence; no system shell registry edits."""
import hashlib
import json
import os
import pathlib
import selectors
import shutil
import subprocess
import tempfile
import time
import unittest

DATA = QTERM_RUNTIME_TEST
SCOPE = {"__name__": "qterm_shell_runtime"}
exec(compile(DATA["owner"], "wsl_owner.py", "exec"), SCOPE)


class SharedExecutableRuntime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert os.getuid() != 0
        cls.fixture = tempfile.TemporaryDirectory(prefix="qterm-wsl-shell-runtime-")
        cls.root = pathlib.Path(cls.fixture.name)
        source = pathlib.Path(subprocess.check_output(
            ["/usr/bin/wslpath", "-u", DATA["binary"]], text=True).strip())
        assert hashlib.sha256(source.read_bytes()).hexdigest() == DATA["sha256"]
        cls.binary = cls.root / "busybox"
        shutil.copyfile(source, cls.binary)
        cls.binary.chmod(0o700)
        for name in ("sh", "ash", "sleep", "yes"):
            (cls.root / name).symlink_to(cls.binary)
        # These are actual declared fixture aliases passed to the classifier's
        # public function argument. Ubuntu's /etc/shells is never replaced.
        cls.shells = {}
        for name in ("sh", "ash"):
            alias = cls.root / name
            cls.shells.setdefault(os.path.realpath(alias), set()).add(alias.name)
        (cls.root / "command.sh").write_text("read -r answer\n")

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def process(self, argv, executable=None):
        child = subprocess.Popen(argv, executable=executable, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env={"PATH":"/usr/bin:/bin","HOME":str(self.root),"ENV":"/dev/null","LANG":"C"},
                                 start_new_session=True)
        self.addCleanup(self.end_process, child)
        self.assertIsNone(child.poll())
        return child

    @staticmethod
    def end_process(child):
        # An unreaped direct child cannot have its PID reused. No other process
        # or tree is signalled by this harness.
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=5)

    def observe(self, child):
        proc = pathlib.Path("/proc") / str(child.pid)
        image = os.path.realpath(proc / "exe", strict=True)
        argv = [part.decode("utf-8", "surrogateescape")
                for part in (proc / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")]
        self.assertEqual(image, str(self.binary))
        return image, argv

    def test_actual_shared_image_preserves_applet_and_interactive_arguments(self):
        cases = [
            ([str(self.root / "ash"), "-i"], None, True),
            ([str(self.root / "sh"), "-i"], None, True),
            ([str(self.binary), "ash", "-i"], None, True),
            ([str(self.binary), "sh", "-i"], None, True),
            (["-ash", "-i"], str(self.binary), True),
            ([str(self.root / "ash"), "-c", "read -r answer"], None, False),
            ([str(self.binary), "sh", "-c", "read -r answer"], None, False),
            ([str(self.root / "sh"), str(self.root / "command.sh")], None, False),
            ([str(self.root / "sleep"), "1000"], None, False),
            ([str(self.binary), "sleep", "1000"], None, False),
            ([str(self.root / "yes")], None, False),
            ([str(self.binary), "yes"], None, False),
        ]
        for argv, executable, expected in cases:
            with self.subTest(argv=argv):
                child = self.process(argv, executable)
                try:
                    image, actual = self.observe(child)
                    self.assertEqual(SCOPE["shell_invocation"](image, actual, self.shells),
                                     expected, (image, actual))
                finally:
                    self.end_process(child)

    def test_unregistered_interactive_image_cannot_claim_a_system_shell(self):
        child = self.process([str(self.binary), "sh", "-i"])
        image, argv = self.observe(child)
        self.assertTrue(SCOPE["shell_invocation"](image, argv, self.shells))
        self.assertFalse(SCOPE["shell_leader"](child.pid))
        with self.assertRaisesRegex(RuntimeError, "there is no shell to keep"):
            SCOPE["programs"](child.pid, True, time.monotonic_ns() + 5_000_000_000)
        self.assertIsNone(child.poll())
        child.stdin.write(b"printf 'BUSYBOX_INPUT_%s\\n' \"$((6*7))\"\n")
        child.stdin.flush()
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ)
        try:
            deadline=time.monotonic()+5
            captured=b""
            while b"BUSYBOX_INPUT_42" not in captured:
                remaining=deadline-time.monotonic()
                self.assertGreater(remaining,0,"BusyBox did not accept real stdin")
                self.assertTrue(selector.select(remaining),"BusyBox did not accept real stdin")
                chunk=os.read(child.stdout.fileno(),8192)
                self.assertTrue(chunk,"BusyBox exited before reporting real stdin")
                captured+=chunk
                self.assertLessEqual(len(captured),65536)
        finally:
            selector.close()

    def test_non_shell_applet_remains_a_direct_program_in_the_real_process_tree(self):
        child = self.process([str(self.binary), "sleep", "1000"])
        self.assertFalse(SCOPE["shell_leader"](child.pid))
        names = SCOPE["programs"](child.pid, False, time.monotonic_ns() + 5_000_000_000)
        self.assertTrue(names, "The live direct program disappeared from ownership evidence")
        with self.assertRaisesRegex(RuntimeError, "there is no shell to keep"):
            SCOPE["programs"](child.pid, True, time.monotonic_ns() + 5_000_000_000)
        self.assertIsNone(child.poll())


unittest.main(argv=["wsl-shell-runtime"], verbosity=2)
