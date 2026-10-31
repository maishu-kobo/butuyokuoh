"""high 判定が、直上コメントや SARIF の抑制では抜けないことを確かめる。"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import high_gate  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST = Path(__file__).resolve().parent / "suppressions.json"


def sarif(results: list[dict], name: str = "js.sarif") -> str:
    return json.dumps(
        {
            "runs": [
                {
                    "tool": {"driver": {"name": "CodeQL", "rules": []}},
                    "results": results,
                }
            ]
        }
    )


def finding(rule: str, uri: str, line: int, score: float | None = 8.0, suppressions: list | None = None) -> dict:
    result: dict = {
        "ruleId": rule,
        "level": "warning",
        "message": {"text": "sample"},
        "locations": [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": uri},
                    "region": {"startLine": line},
                }
            }
        ],
    }
    if score is not None:
        result["properties"] = {"security-severity": str(score)}
    if suppressions is not None:
        result["suppressions"] = suppressions
    return result


class HighGateTest(unittest.TestCase):
    def evaluate(self, repo: Path, results: list[dict], allowlist: list[dict]) -> bool:
        sarif_dir = repo / "out"
        sarif_dir.mkdir()
        (sarif_dir / "js.sarif").write_text(sarif(results), encoding="utf-8")
        allow_path = repo / "suppressions.json"
        allow_path.write_text(json.dumps({"suppressions": allowlist}), encoding="utf-8")
        entries = high_gate.load_allowlist(allow_path)
        _lines, failed = high_gate.evaluate(sarif_dir, entries, repo)
        return failed

    def test_previous_line_comment_does_not_suppress(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            source.write_text(
                "// codeql[js/user-controlled-bypass]\n"
                "if (!normalizedEmail || !password) {\n",
                encoding="utf-8",
            )
            failed = self.evaluate(
                repo,
                [finding("js/user-controlled-bypass", "src/login.ts", 2)],
                [],
            )
            self.assertTrue(failed)

    def test_sarif_suppression_does_not_suppress(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            source.write_text("if (!normalizedEmail || !password) {\n", encoding="utf-8")
            result = finding(
                "js/user-controlled-bypass",
                "src/login.ts",
                1,
                suppressions=[{}, {"status": "accepted"}],
            )
            self.assertTrue(self.evaluate(repo, [result], []))

    def test_exact_allowlist_line_is_excluded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            line = "if (!normalizedEmail || !password) {"
            source.write_text(line + "\n", encoding="utf-8")
            allow = [{"rule": "js/user-controlled-bypass", "path": "src/login.ts", "line": line}]
            failed = self.evaluate(
                repo,
                [
                    finding("js/user-controlled-bypass", "src/login.ts", 1),
                    finding("js/user-controlled-bypass", "src/login.ts", 1),
                ],
                allow,
            )
            self.assertFalse(failed)

    def test_same_rule_on_a_different_line_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            known = "if (!normalizedEmail || !password) {"
            other = "if (user.role === 'admin') {"
            source.write_text(known + "\n" + other + "\n", encoding="utf-8")
            allow = [{"rule": "js/user-controlled-bypass", "path": "src/login.ts", "line": known}]
            failed = self.evaluate(
                repo,
                [finding("js/user-controlled-bypass", "src/login.ts", 2)],
                allow,
            )
            self.assertTrue(failed)

    def test_missing_sarif_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            with self.assertRaises(high_gate.GateError):
                high_gate.evaluate(repo / "missing", [], repo)

    def test_missing_severity_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            source.write_text("if (!normalizedEmail || !password) {\n", encoding="utf-8")
            failed = self.evaluate(
                repo,
                [finding("js/user-controlled-bypass", "src/login.ts", 1, score=None)],
                [],
            )
            self.assertTrue(failed)

    def test_below_high_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            source = repo / "src" / "login.ts"
            source.parent.mkdir(parents=True)
            source.write_text("return name;\n", encoding="utf-8")
            self.assertFalse(
                self.evaluate(repo, [finding("js/some-note", "src/login.ts", 1, score=6.9)], [])
            )

    def test_malformed_allowlist_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "suppressions.json"
            path.write_text('{"suppressions":[{"rule":"*"}]}', encoding="utf-8")
            with self.assertRaises(high_gate.GateError):
                high_gate.load_allowlist(path)

    def test_committed_allowlist_matches_source_lines(self) -> None:
        entries = high_gate.load_allowlist(ALLOWLIST)
        self.assertEqual(len(entries), 9)
        results = []
        for entry in entries:
            lines = (ROOT / entry["path"]).read_text(encoding="utf-8").splitlines()
            self.assertIn(entry["line"], lines)
            # GitHub CodeQL 用の // codeql[...] 抑制コメントは許可する（high_gate 自体は見ない）。
            results.append(finding(entry["rule"], entry["path"], lines.index(entry["line"]) + 1))
        with tempfile.TemporaryDirectory() as tmp:
            sarif_dir = Path(tmp)
            (sarif_dir / "js.sarif").write_text(sarif(results), encoding="utf-8")
            _lines, failed = high_gate.evaluate(sarif_dir, entries, ROOT)
            self.assertFalse(failed)
            first = entries[0]
            source_lines = (ROOT / first["path"]).read_text(encoding="utf-8").splitlines()
            known = source_lines.index(first["line"])
            neighbor = known + 1 if known + 1 < len(source_lines) else known - 1
            self.assertNotEqual(source_lines[neighbor], first["line"])
            (sarif_dir / "js.sarif").write_text(
                sarif([finding(first["rule"], first["path"], neighbor + 1)]),
                encoding="utf-8",
            )
            _lines, failed = high_gate.evaluate(sarif_dir, entries, ROOT)
            self.assertTrue(failed)


if __name__ == "__main__":
    unittest.main()
