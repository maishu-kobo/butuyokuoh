"""Exercise the workflow's ingestion guard through a fake GitHub CLI, without a network."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("verify_ingestion.sh")


class VerifyIngestionTest(unittest.TestCase):
    def run_guard(self, status="complete", api_exit=0, sarif_id="upload-id"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            call_log = root / "gh-call"
            gh = root / "gh"
            gh.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$@" > "$GH_CALL_LOG"\n'
                'printf "%s\\n" "$MOCK_STATUS"\n'
                'exit "$MOCK_EXIT"\n',
                encoding="utf-8",
            )
            gh.chmod(0o755)
            env = {
                **os.environ,
                "PATH": str(root) + os.pathsep + os.environ["PATH"],
                "GH_TOKEN": "test-token-never-log",
                "GITHUB_REPOSITORY": "test/repo",
                "GH_CALL_LOG": str(call_log),
                "MOCK_STATUS": status,
                "MOCK_EXIT": str(api_exit),
            }
            if sarif_id is None:
                env.pop("SARIF_ID", None)
            else:
                env["SARIF_ID"] = sarif_id
            result = subprocess.run(
                ["bash", str(SCRIPT)], cwd=root, env=env,
                capture_output=True, text=True, check=False,
            )
            self.assertNotIn(env["GH_TOKEN"], result.stdout + result.stderr)
            calls = call_log.read_text(encoding="utf-8").splitlines() if call_log.exists() else []
            return result, calls

    def test_complete_passes_and_requests_the_exact_upload(self):
        result, calls = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CodeQL ingestion confirmed complete.", result.stdout)
        self.assertEqual(calls, ["api", "repos/test/repo/code-scanning/sarifs/upload-id", "--jq", ".processing_status"])

    def test_pending_and_failed_stop_with_the_status(self):
        for status in ["pending", "failed"]:
            with self.subTest(status=status):
                result, _ = self.run_guard(status)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"CodeQL ingestion status: {status}.", result.stdout)

    def test_unknown_empty_and_multiline_statuses_fail_closed(self):
        for status in ["", "unknown", "complete\nfailed", "::warning::untrusted"]:
            with self.subTest(status=status):
                result, _ = self.run_guard(status)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unknown processing status", result.stdout)
                self.assertNotIn("::warning::untrusted", result.stdout)

    def test_empty_and_missing_id_stop_before_the_api_call(self):
        for sarif_id in ["", None]:
            with self.subTest(sarif_id=sarif_id):
                result, calls = self.run_guard(sarif_id=sarif_id)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("did not return a SARIF upload ID", result.stdout)
                self.assertEqual(calls, [])

    def test_api_failure_cannot_pass_even_with_complete_in_stdout(self):
        result, _ = self.run_guard("complete", api_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unable to retrieve", result.stdout)
        self.assertNotIn("ingestion confirmed complete", result.stdout)

    def test_id_is_one_argument_and_is_not_evaluated_as_shell(self):
        unusual_id = "upload id;$(printf injected)"
        result, calls = self.run_guard(sarif_id=unusual_id)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[1], f"repos/test/repo/code-scanning/sarifs/{unusual_id}")


if __name__ == "__main__":
    unittest.main()
