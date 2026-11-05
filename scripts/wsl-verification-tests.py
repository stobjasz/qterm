"""Real monitor processes, sockets, signals and immutable-context checks."""
import pathlib
import shutil
import unittest


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="qterm-wsl-monitor-"))
        self.repo = self.root / "Case"
        self.repo.mkdir()
        repo_git(str(self.repo), ["init", "--quiet", "--initial-branch=source"])
        self.file = self.repo / "value.txt"
        self.file.write_text("one")
        self.token = os.urandom(32).hex()
        self.life = self.root / "lifetime"
        self.life.write_text(self.token)
        self.fd = None
        self.pid = None
        self.start = None

    def tearDown(self):
        timed_out = False
        if self.life.exists():
            self.life.unlink()
        if self.fd is not None:
            if not select.select([self.fd], [], [], 5)[0]:
                signal.pidfd_send_signal(self.fd, signal.SIGKILL)
                timed_out = True
            os.close(self.fd)
            os.waitpid(self.pid, 0)
        assert self.root.resolve() == self.root and self.root.parent == pathlib.Path("/tmp") and self.root.name.startswith("qterm-wsl-monitor-")
        shutil.rmtree(self.root)
        if timed_out:
            self.fail("Owned fixture monitor did not end after lifetime removal")

    def launch(self):
        self.start = verification_start({"token": self.token, "lifetime": str(self.life), "cwd": str(self.repo)})
        self.pid = self.start["identity"][0]
        self.fd = os.pidfd_open(self.pid)
        return self.start

    def request(self, action):
        return verification_request({"token": self.token, "action": action})

    def test_unchanged_finish_preserves_snapshot_and_closes_the_monitor(self):
        started = self.launch()
        self.assertEqual(self.request("status"), {"changed": False, "after": None})
        result = self.request("finish")
        self.assertFalse(result["changed"])
        self.assertEqual(result["after"]["digest"], started["before"]["digest"])
        self.assertTrue(select.select([self.fd], [], [], 2)[0])

    def test_edit_and_restore_across_requests_remains_stale(self):
        self.launch()
        self.file.write_text("two")
        self.file.write_text("one")
        self.assertTrue(self.request("status")["changed"])
        result = self.request("finish")
        self.assertTrue(result["changed"])
        self.assertIsNone(result["after"])

    def test_invalid_authentication_and_extra_context_fields_do_not_cancel(self):
        self.launch()
        for extras in ({"proof": "0" * 64}, {"cwd": "/"}):
            nonce = os.urandom(16).hex()
            expires = time.monotonic_ns() + 1_000_000_000
            proof = hmac.new(self.token.encode(), (nonce + "\ncancel\n" + str(expires)).encode(), hashlib.sha256).hexdigest()
            request = {"nonce": nonce, "method": "cancel", "expires": expires, "proof": proof, **extras}
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(verification_address(self.token))
                client.sendall((json.dumps(request) + "\n").encode())
                self.assertEqual(client.recv(8192), b"")
            self.assertFalse(self.request("status")["changed"])

    def test_an_expired_authenticated_finish_does_not_close_the_monitor(self):
        self.launch()
        nonce = os.urandom(16).hex()
        expires = time.monotonic_ns() - 1
        proof = hmac.new(self.token.encode(), (nonce + "\nfinish\n" + str(expires)).encode(), hashlib.sha256).hexdigest()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(verification_address(self.token))
            client.sendall((json.dumps({"nonce": nonce, "method": "finish", "expires": expires, "proof": proof}) + "\n").encode())
            envelope = json.loads(client.recv(8192))
        self.assertIn("expired", json.loads(envelope["payload"])["error"])
        self.assertFalse(self.request("status")["changed"])

    def test_cancel_releases_the_process_and_listener(self):
        self.launch()
        self.assertTrue(self.request("cancel"))
        self.assertTrue(select.select([self.fd], [], [], 2)[0])
        with self.assertRaises((ConnectionError, OSError)):
            self.request("status")

    def test_lifetime_replacement_ends_the_pinned_monitor(self):
        self.launch()
        replacement = self.root / "replacement"
        replacement.write_text(self.token)
        replacement.replace(self.life)
        self.assertTrue(select.select([self.fd], [], [], 3)[0])
        with self.assertRaises((ConnectionError, OSError)):
            self.request("status")

    def test_repository_replacement_cannot_capture_a_new_context_as_unchanged(self):
        self.launch()
        self.repo.rename(self.root / "original")
        shutil.copytree(self.root / "original", self.repo)
        result = self.request("finish")
        self.assertTrue(result["changed"])
        self.assertIsNone(result["after"])

    def test_forged_monitor_responses_are_rejected(self):
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(verification_address(self.token))
        server.listen(1)
        def forge():
            with server:
                connection, _ = server.accept()
                with connection:
                    connection.recv(2048)
                    connection.sendall((json.dumps({"payload": json.dumps({"result": {"changed": False}}), "proof": "0" * 64}) + "\n").encode())
        worker = threading.Thread(target=forge)
        worker.start()
        try:
            with self.assertRaisesRegex(ValueError, "authentication failed"):
                self.request("status")
        finally:
            worker.join(3)
            self.assertFalse(worker.is_alive())


unittest.main(argv=["wsl-verification-tests"], verbosity=2)
