"""CodeQL の SARIF を読み、high が残っていれば終了コード 1 にする。

ソースの `// codeql[rule-id]` と、SARIF の suppressions は見ない。
例外は抑制リストの rule、path、行本文がすべて一致する結果だけ。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import unquote

HIGH = 7.0
ENTRY_KEYS = {"rule", "path", "line", "reason"}


class GateError(Exception):
    """抑制リストか SARIF が壊れていて、通してよいか判断できない。"""


def load_allowlist(path: Path) -> list[dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise GateError(f"抑制リストを読めない: {exc}") from exc
    if not isinstance(data, dict) or set(data) != {"suppressions"}:
        raise GateError("抑制リストは suppressions だけを持つ")
    entries = data["suppressions"]
    if not isinstance(entries, list):
        raise GateError("suppressions は配列")
    cleaned: list[dict[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict) or not set(entry) <= ENTRY_KEYS:
            raise GateError("抑制の項目が rule、path、line、reason 以外を含む")
        if not {"rule", "path", "line"} <= set(entry):
            raise GateError("抑制には rule、path、line が要る")
        rule = entry["rule"]
        rel = entry["path"]
        line = entry["line"]
        reason = entry.get("reason", "")
        if not all(isinstance(value, str) for value in (rule, rel, line, reason)):
            raise GateError("抑制の値は文字列")
        if rule == "" or rel == "" or line == "":
            raise GateError("抑制の rule、path、line は空にできない")
        if any(char in line for char in "\n\r"):
            raise GateError("抑制の line は1行")
        parts = Path(rel).parts
        if Path(rel).is_absolute() or ".." in parts or not parts:
            raise GateError(f"抑制の path がリポジトリ相対ではない: {rel}")
        cleaned.append({"rule": rule, "path": Path(rel).as_posix(), "line": line})
    return cleaned


def normalize_uri(uri: str, root: Path) -> str | None:
    text = unquote(uri.strip()).replace("\\", "/")
    if text.startswith("file://"):
        text = text[7:]
    while text.startswith("./"):
        text = text[2:]
    path = Path(text)
    root_resolved = root.resolve()
    if path.is_absolute():
        try:
            relative = path.resolve().relative_to(root_resolved)
        except ValueError:
            return None
        return relative.as_posix()
    if ".." in path.parts or not path.parts:
        return None
    return path.as_posix()


def source_line(root: Path, uri: str, line_no: object) -> str | None:
    if not isinstance(uri, str) or not isinstance(line_no, int) or line_no < 1:
        return None
    relative = normalize_uri(uri, root)
    if relative is None:
        return None
    root_resolved = root.resolve()
    path = (root_resolved / relative).resolve()
    try:
        path.relative_to(root_resolved)
    except ValueError:
        return None
    if not path.is_file():
        return None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return None
    if line_no > len(lines):
        return None
    return lines[line_no - 1]


def allowlisted(entries: list[dict[str, str]], rule: str, uri: str, line: str | None, root: Path) -> bool:
    if line is None:
        return False
    relative = normalize_uri(uri, root) if isinstance(uri, str) else None
    if relative is None:
        return False
    return any(
        entry["rule"] == rule and entry["path"] == relative and entry["line"] == line
        for entry in entries
    )


def severity(result: dict, rules: dict) -> float | None:
    props = result.get("properties") or {}
    raw = props.get("security-severity")
    if raw is None:
        rule = rules.get(result.get("ruleId") or "")
        raw = ((rule or {}).get("properties") or {}).get("security-severity")
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def rules_of(run: dict) -> dict:
    found: dict = {}
    tool = run.get("tool") or {}
    chunks = [tool.get("driver") or {}]
    chunks.extend(tool.get("extensions") or [])
    for chunk in chunks:
        for rule in chunk.get("rules") or []:
            if isinstance(rule, dict) and rule.get("id"):
                found[rule["id"]] = rule
    return found


def evaluate(sarif_dir: Path, entries: list[dict[str, str]], root: Path) -> tuple[list[str], bool]:
    try:
        files = sorted(path for path in sarif_dir.rglob("*.sarif") if path.is_file())
    except OSError as exc:
        raise GateError(f"SARIF を読めない: {exc}") from exc
    if not files:
        raise GateError("CodeQL の SARIF が無い。解析に失敗している")

    lines: list[str] = []
    failed = False
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise GateError(f"SARIF を読めない: {path.name}: {exc}") from exc
        if not isinstance(data, dict):
            raise GateError(f"SARIF の形が違う: {path.name}")
        runs = data.get("runs", [])
        if not isinstance(runs, list):
            raise GateError(f"SARIF の runs が配列ではない: {path.name}")
        for run in runs:
            if not isinstance(run, dict):
                raise GateError(f"SARIF の run がオブジェクトではない: {path.name}")
            rules = rules_of(run)
            results = run.get("results") or []
            if not isinstance(results, list):
                raise GateError(f"SARIF の results が配列ではない: {path.name}")
            lines.append(f"{path.name}: {len(results)} results")
            for result in results:
                if not isinstance(result, dict):
                    raise GateError(f"SARIF の result がオブジェクトではない: {path.name}")
                score = severity(result, rules)
                level = result.get("level", "warning")
                rule = result.get("ruleId") or ""
                if not isinstance(rule, str):
                    rule = ""
                message = ((result.get("message") or {}).get("text") or "").split("\n", 1)[0]
                location = ((result.get("locations") or [{}])[0].get("physicalLocation") or {})
                uri = (location.get("artifactLocation") or {}).get("uri", "")
                line_no = (location.get("region") or {}).get("startLine", "")
                text = source_line(root, uri, line_no)
                quiet = allowlisted(entries, rule, uri if isinstance(uri, str) else "", text, root)
                score_text = "none" if score is None else f"{score:.1f}"
                lines.append(
                    f"- {level} severity={score_text} allowlisted={quiet} {rule} {uri}:{line_no} {message}"
                )
                if quiet:
                    continue
                if score is None or score >= HIGH:
                    failed = True
    return lines, failed


def write_summary(lines: list[str]) -> None:
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    with open(summary, "a", encoding="utf-8") as handle:
        handle.write("## CodeQL\n\n```\n" + "\n".join(lines) + "\n```\n")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        print(
            "usage: high_gate.py SARIF_DIR ALLOWLIST.json ROOT",
            file=sys.stderr,
        )
        return 1
    sarif_dir, allowlist_path, root = (Path(arg) for arg in args)
    try:
        entries = load_allowlist(allowlist_path)
        lines, failed = evaluate(sarif_dir, entries, root)
    except GateError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print("\n".join(lines))
    write_summary(lines)
    if failed:
        print("security-severity が 7.0 以上、または不明な結果がある", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
