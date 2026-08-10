#!/usr/bin/env python3
"""Generate an exact, source-bound authority-surface inventory for Custodial v4.3.

This scanner reads a frozen Git commit through Git object plumbing. It does not
inspect the mutable working tree as source authority. The output is evidence,
not an automatic retain/retire decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".sql", ".yml", ".yaml", ".json", ".md"
}

EXCLUDED_PREFIXES = (
    "node_modules/",
    "public/moxie-assets/",
    "research/",
    "home/",
)

CORE_PATTERNS = {
    "SQL_FUNCTION": re.compile(r"\bcreate\s+(?:or\s+replace\s+)?function\s+([\w\".]+)\s*\(", re.I),
    "SQL_TRIGGER": re.compile(r"\bcreate\s+(?:or\s+replace\s+)?trigger\s+([\w\"]+)", re.I),
    "SQL_CRON": re.compile(r"\bcron\.schedule\s*\(", re.I),
    "HTTP_ROUTE": re.compile(r"\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*([\"'`])([^\"'`]+)\2", re.I),
    "RPC_CALL": re.compile(r"\b(?:runRpc|run_rpc|supabase\.rpc)\s*\(\s*([\"'`])([^\"'`]+)\1", re.I),
}

CRITICAL_AUTHORITY_MARKER_PATTERN = re.compile(
    r"\b(noauth_full|run_application_write|run_sql_migration|"
    r"msg_get_or_create_ops_manager_thread)\b",
    re.I,
)

WRITE_WORDS = re.compile(
    r"\b(insert|update|delete|upsert|merge|truncate|alter|drop|create|grant|revoke|"
    r"run_application_write|run_sql_migration|github_write|github_update|github_delete|"
    r"supabase_migration_apply|writeFile|updateFile|deleteFile)\b",
    re.I,
)

READ_WORDS = re.compile(r"\b(select|read|fetch|get|list|search|diagnose|health)\b", re.I)

SECURITY_WORDS = re.compile(
    r"\b(security\s+definer|service_role|admin_api_key|mcp_allow_full_noauth|"
    r"read_only|authorization|credential|token|grant|revoke|row\s+level\s+security|force\s+row\s+level\s+security)\b",
    re.I,
)

COMPAT_WORDS = re.compile(r"\b(legacy|compat|fallback|deprecated|retire|rollback|repair|temporary|bridge)\b", re.I)

GIT_BLOB_BY_PATH: dict[str, str] = {}


def run_git(*args: str) -> str:
    proc = subprocess.run(["git", *args], check=True, text=True, capture_output=True)
    return proc.stdout


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def excerpt(text: str, offset: int, width: int = 360) -> str:
    start = max(0, text.rfind("\n", 0, offset) + 1)
    end = text.find("\n", offset)
    if end < 0:
        end = len(text)
    value = text[start : min(len(text), max(end, start + width))]
    value = re.sub(r"\s+", " ", value).strip()
    return value[:width]


def stable_id(repo: str, commit: str, path: str, line: int, category: str, symbol: str) -> str:
    digest = sha256_text("|".join([repo, commit, path, str(line), category, symbol]))[:20]
    return f"SURF-BACKEND-{digest.upper()}"


def classify_mutation(category: str, method: str | None, context: str) -> str:
    if category == "HTTP_ROUTE":
        return "READ_ONLY_CANDIDATE" if str(method).upper() == "GET" else "MUTATION_CAPABLE"
    if category in {"SQL_TRIGGER", "SQL_CRON", "SQL_GRANT", "SQL_POLICY"}:
        return "MUTATION_OR_AUTHORITY_CAPABLE"
    if WRITE_WORDS.search(context):
        return "MUTATION_CAPABLE"
    if READ_WORDS.search(context):
        return "READ_ONLY_CANDIDATE"
    return "REQUIRES_CALL_GRAPH_CLASSIFICATION"


def disposition_hint(category: str, symbol: str, context: str) -> str:
    combined = f"{symbol} {context}".lower()
    if "mcp_allow_full_noauth" in combined or "noauth_full" in combined:
        return "RETIRE_UNSAFE_ANONYMOUS_AUTHORITY"
    if category == "SQL_CRON":
        return "RESEARCH_AND_EXPLICIT_ADMISSION_OR_RETIREMENT"
    if COMPAT_WORDS.search(combined):
        return "COMPATIBILITY_OR_REPAIR_REQUIRES_BOUNDED_DISPOSITION"
    return "RESEARCH_REQUIRED"


def security_signals(context: str) -> list[str]:
    values = {m.group(0).lower().replace(" ", "_") for m in SECURITY_WORDS.finditer(context)}
    return sorted(values)


def add_entry(
    entries: list[dict[str, Any]],
    *,
    repository: str,
    commit: str,
    tree: str,
    path: str,
    file_digest: str,
    category: str,
    symbol: str,
    offset: int,
    text: str,
    method: str | None = None,
    route: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    git_blob = GIT_BLOB_BY_PATH.get(path)
    if git_blob is None:
        raise RuntimeError(f"missing Git blob identity for {path}")
    line = line_number(text, offset)
    context_start = max(0, offset - 180)
    context_end = min(len(text), offset + 1200)
    context = text[context_start:context_end]
    entry: dict[str, Any] = {
        "id": stable_id(repository, commit, path, line, category, symbol),
        "repository": repository,
        "source_commit": commit,
        "source_tree": tree,
        "path": path,
        "git_blob_sha1": git_blob,
        "file_sha256": file_digest,
        "line": line,
        "category": category,
        "symbol": symbol,
        "method": method,
        "route": route,
        "source_state": "PRESENT_AT_FROZEN_COMMIT",
        "mutation_class": classify_mutation(category, method, context),
        "security_signals": security_signals(context),
        "compatibility_signal": bool(COMPAT_WORDS.search(context)),
        "evidence_excerpt": excerpt(text, offset),
        "target_disposition": disposition_hint(category, symbol, context),
        "proof_status": "SOURCE_OBSERVED_ONLY_NOT_YET_ADMITTED",
    }
    if extra:
        entry.update(extra)
    entries.append(entry)


def scan_sql(
    entries: list[dict[str, Any]],
    *,
    repository: str,
    commit: str,
    tree: str,
    path: str,
    digest: str,
    text: str,
    observed: Counter[str],
) -> None:
    for match in CORE_PATTERNS["SQL_FUNCTION"].finditer(text):
        observed["SQL_FUNCTION"] += 1
        name = match.group(1).replace('"', "")
        tail = text[match.start() : min(len(text), match.start() + 6000)]
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="SQL_FUNCTION",
            symbol=name,
            offset=match.start(),
            text=text,
            extra={
                "security_definer": bool(re.search(r"\bsecurity\s+definer\b", tail, re.I)),
                "search_path_declared": bool(re.search(r"\bsearch_path\b", tail, re.I)),
                "writes_detected": bool(WRITE_WORDS.search(tail)),
            },
        )

    for match in CORE_PATTERNS["SQL_TRIGGER"].finditer(text):
        observed["SQL_TRIGGER"] += 1
        name = match.group(1).replace('"', "")
        tail = text[match.start() : min(len(text), match.start() + 1600)]
        table = re.search(r"\bon\s+([\w\".]+)", tail, re.I)
        target = re.search(r"execute\s+(?:function|procedure)\s+([\w\".]+)", tail, re.I)
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="SQL_TRIGGER",
            symbol=name,
            offset=match.start(),
            text=text,
            extra={
                "table": table.group(1).replace('"', "") if table else None,
                "executes": target.group(1).replace('"', "") if target else None,
            },
        )

    for match in CORE_PATTERNS["SQL_CRON"].finditer(text):
        observed["SQL_CRON"] += 1
        tail = text[match.start() : min(len(text), match.start() + 1200)]
        strings = re.findall(r"['\"]([^'\"]+)['\"]", tail[:600])
        symbol = strings[0] if strings else f"cron.schedule@{line_number(text, match.start())}"
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="SQL_CRON",
            symbol=symbol,
            offset=match.start(),
            text=text,
            extra={"cron_arguments_preview": strings[:4]},
        )

    for regex, category in [
        (re.compile(r"\bcreate\s+policy\s+([\w\"]+)", re.I), "SQL_POLICY"),
        (re.compile(r"\bgrant\s+execute\s+on\s+function\s+([^;]+)", re.I), "SQL_GRANT"),
        (re.compile(r"\brevoke\s+[^;]+\s+from\s+([^;]+)", re.I), "SQL_REVOKE"),
    ]:
        for match in regex.finditer(text):
            symbol = re.sub(r"\s+", " ", match.group(1).replace('"', "")).strip()[:240]
            add_entry(
                entries,
                repository=repository,
                commit=commit,
                tree=tree,
                path=path,
                file_digest=digest,
                category=category,
                symbol=symbol,
                offset=match.start(),
                text=text,
            )


def scan_program_source(
    entries: list[dict[str, Any]],
    *,
    repository: str,
    commit: str,
    tree: str,
    path: str,
    digest: str,
    text: str,
    observed: Counter[str],
) -> None:
    seen_critical_markers: set[tuple[int, str]] = set()
    for match in CRITICAL_AUTHORITY_MARKER_PATTERN.finditer(text):
        symbol = match.group(1)
        key = (line_number(text, match.start()), symbol.lower())
        if key in seen_critical_markers:
            continue
        seen_critical_markers.add(key)
        observed["CRITICAL_AUTHORITY_MARKER"] += 1
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="CRITICAL_AUTHORITY_MARKER",
            symbol=symbol,
            offset=match.start(),
            text=text,
        )

    for match in CORE_PATTERNS["HTTP_ROUTE"].finditer(text):
        observed["HTTP_ROUTE"] += 1
        method = match.group(1).upper()
        route = match.group(3)
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="HTTP_ROUTE",
            symbol=f"{method} {route}",
            method=method,
            route=route,
            offset=match.start(),
            text=text,
        )

    for match in CORE_PATTERNS["RPC_CALL"].finditer(text):
        observed["RPC_CALL"] += 1
        name = match.group(2)
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="RPC_CALL",
            symbol=name,
            offset=match.start(),
            text=text,
        )

    patterns = [
        (re.compile(r"\b(runApplicationWrite|run_application_write|runSqlMigration|run_sql_migration|runReadOnlySql|run_read_only_sql)\s*\("), "SQL_EXECUTOR_CALL"),
        (re.compile(r"\b(?:server|mcpServer)\.(?:tool|registerTool)\s*\(\s*([\"'`])([^\"'`]+)\1"), "MCP_TOOL_REGISTRATION"),
        (re.compile(r"\b(github_[a-z0-9_]+|supabase_[a-z0-9_]+)\b", re.I), "TOOL_IDENTIFIER"),
        (re.compile(r"\b(MCP_[A-Z0-9_]+|ADMIN_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\b"), "AUTH_CONFIGURATION"),
    ]
    for regex, category in patterns:
        seen: set[tuple[int, str]] = set()
        for match in regex.finditer(text):
            symbol = (match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(1))
            key = (line_number(text, match.start()), symbol)
            if key in seen:
                continue
            seen.add(key)
            add_entry(
                entries,
                repository=repository,
                commit=commit,
                tree=tree,
                path=path,
                file_digest=digest,
                category=category,
                symbol=symbol,
                offset=match.start(),
                text=text,
            )

    if path.startswith("scripts/") and path.endswith((".js", ".mjs", ".cjs", ".ts")):
        mutation = bool(WRITE_WORDS.search(text) or re.search(r"process\.env|supabase|github|migration|restore|repair|deploy|release", text, re.I))
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="SCRIPT_ENTRYPOINT",
            symbol=Path(path).name,
            offset=0,
            text=text,
            extra={"mutation_candidate": mutation},
        )

    if path.startswith(".github/workflows/") and path.endswith((".yml", ".yaml")):
        name = re.search(r"^name:\s*(.+)$", text, re.M)
        add_entry(
            entries,
            repository=repository,
            commit=commit,
            tree=tree,
            path=path,
            file_digest=digest,
            category="WORKFLOW",
            symbol=(name.group(1).strip() if name else Path(path).name),
            offset=0,
            text=text,
            extra={"mutation_candidate": bool(re.search(r"push|deploy|migration|write|restore|repair|release", text, re.I))},
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--repository", default="lasrevinu333-design/memphis-zoo-mcp")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    commit = run_git("rev-parse", f"{args.commit}^{{commit}}").strip()
    if commit != args.commit:
        raise SystemExit(f"commit mismatch: expected {args.commit}, got {commit}")
    tree = run_git("rev-parse", f"{commit}^{{tree}}").strip()
    GIT_BLOB_BY_PATH.clear()
    for row in run_git("ls-tree", "-r", commit).splitlines():
        metadata, path = row.split("\t", 1)
        _mode, object_type, object_id = metadata.split()
        if object_type == "blob":
            GIT_BLOB_BY_PATH[path] = object_id
    paths = sorted(GIT_BLOB_BY_PATH)

    entries: list[dict[str, Any]] = []
    file_manifest: list[dict[str, Any]] = []
    observed: Counter[str] = Counter()
    scanned = 0
    decode_failures: list[str] = []

    for path in paths:
        if path.startswith(EXCLUDED_PREFIXES):
            continue
        suffix = Path(path).suffix.lower()
        if suffix not in TEXT_SUFFIXES and not path.startswith(".github/workflows/"):
            continue
        try:
            text = run_git("show", f"{commit}:{path}")
        except subprocess.CalledProcessError:
            decode_failures.append(path)
            continue
        if "\x00" in text:
            continue
        scanned += 1
        digest = sha256_text(text)
        file_manifest.append({
            "path": path,
            "git_blob_sha1": GIT_BLOB_BY_PATH[path],
            "sha256": digest,
            "bytes_utf8": len(text.encode("utf-8")),
        })
        if suffix == ".sql":
            scan_sql(
                entries,
                repository=args.repository,
                commit=commit,
                tree=tree,
                path=path,
                digest=digest,
                text=text,
                observed=observed,
            )
        scan_program_source(
            entries,
            repository=args.repository,
            commit=commit,
            tree=tree,
            path=path,
            digest=digest,
            text=text,
            observed=observed,
        )

    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        duplicates = [key for key, count in Counter(ids).items() if count > 1]
        raise SystemExit(f"duplicate inventory IDs: {duplicates[:10]}")

    emitted = Counter(entry["category"] for entry in entries)
    coverage = {
        key: {"observed": observed[key], "emitted": emitted[key], "pass": observed[key] == emitted[key]}
        for key in CORE_PATTERNS
    }
    coverage["CRITICAL_AUTHORITY_MARKER"] = {
        "observed": observed["CRITICAL_AUTHORITY_MARKER"],
        "emitted": emitted["CRITICAL_AUTHORITY_MARKER"],
        "pass": observed["CRITICAL_AUTHORITY_MARKER"]
        == emitted["CRITICAL_AUTHORITY_MARKER"],
    }
    if not all(item["pass"] for item in coverage.values()):
        raise SystemExit(f"core coverage mismatch: {coverage}")

    minimums = {
        "SQL_FUNCTION": 20,
        "SQL_TRIGGER": 5,
        "HTTP_ROUTE": 20,
        "RPC_CALL": 10,
        "SCRIPT_ENTRYPOINT": 20,
        "WORKFLOW": 5,
    }
    failed_minimums = {key: {"expected_at_least": value, "actual": emitted[key]} for key, value in minimums.items() if emitted[key] < value}
    if failed_minimums:
        raise SystemExit(f"inventory coverage unexpectedly shallow: {failed_minimums}")

    by_path: dict[str, list[str]] = defaultdict(list)
    for entry in entries:
        by_path[entry["path"]].append(entry["id"])

    package: dict[str, Any] = {
        "protocol": "CUSTODIAL_V43_BACKEND_AUTHORITY_SURFACE_INVENTORY_V1",
        "status": "SOURCE_INVENTORY_COMPLETE_DISPOSITIONS_PENDING_ARCHITECTURE_REVIEW",
        "repository": args.repository,
        "source_commit": commit,
        "source_tree": tree,
        "scanner": {
            "path": "scripts/generate-custodial-v43-backend-authority-inventory.py",
            "mode": "git-object-read-only",
            "working_tree_is_not_source_authority": True,
        },
        "summary": {
            "repository_paths": len(paths),
            "text_files_scanned": scanned,
            "files_with_authority_entries": len(by_path),
            "entries": len(entries),
            "categories": dict(sorted(emitted.items())),
            "decode_failures": decode_failures,
        },
        "core_pattern_coverage": coverage,
        "minimum_coverage": {key: {"expected_at_least": value, "actual": emitted[key], "pass": emitted[key] >= value} for key, value in minimums.items()},
        "limitations": [
            "Source presence is not proof that a surface is live in production.",
            "Mutation classification is conservative and requires architecture disposition plus live evidence where applicable.",
            "Dynamic route, SQL, reflection, generated source, external provider, and configuration-driven callers require explicit follow-up even when no static literal exists.",
            "No entry is admitted merely because it appears in this inventory."
        ],
        "files": sorted(file_manifest, key=lambda item: item["path"]),
        "entries": sorted(entries, key=lambda item: (item["path"], item["line"], item["category"], item["symbol"])),
        "path_index": {path: sorted(values) for path, values in sorted(by_path.items())},
        "acceptance": {
            "exact_repository_commit_bound": True,
            "core_observed_equals_emitted": True,
            "unique_stable_ids": True,
            "generic_category_only_entries_forbidden": True,
            "downstream_authority": False,
            "next_gate": "architecture_disposition_join_and_live_source_reconciliation"
        },
    }

    canonical_without_digest = json.dumps(package, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    package["inventory_sha256"] = sha256_text(canonical_without_digest)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(package, indent=2, sort_keys=True, ensure_ascii=False) + "\n")

    parsed = json.loads(output.read_text())
    if parsed["source_commit"] != commit or parsed["acceptance"]["downstream_authority"] is not False:
        raise SystemExit("post-write verification failed")
    print(json.dumps({
        "status": "PASS",
        "protocol": package["protocol"],
        "source_commit": commit,
        "entries": len(entries),
        "categories": dict(sorted(emitted.items())),
        "inventory_sha256": package["inventory_sha256"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
