#!/usr/bin/env python3
"""
Repair remote D1 migration journal drift.

When tables/columns were created outside wrangler (or a prior apply partially
succeeded), `wrangler d1 migrations apply --remote` fails with
"table already exists". This script stamps pending migration files as applied
IFF every CREATE TABLE / ALTER TABLE ADD they declare is already present on
the remote DB — then a normal `wrangler d1 migrations apply --remote` can
run the remaining ones safely.

Requires CLOUDFLARE_API_TOKEN (and optional CLOUDFLARE_ACCOUNT_ID) in env.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
DB = "family-vault-db"


def wrangler_json(command: str) -> list[dict]:
    proc = subprocess.run(
        [
            "npx",
            "wrangler",
            "d1",
            "execute",
            DB,
            "--remote",
            "--json",
            "--command",
            command,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"wrangler execute failed ({proc.returncode}): {command}")
    # wrangler may print non-JSON logs before the array — take the last JSON value.
    text = proc.stdout.strip()
    start = text.find("[")
    if start < 0:
        raise SystemExit(f"no JSON array in wrangler output for: {command}\n{text}")
    payload = json.loads(text[start:])
    if not payload:
        return []
    return payload[0].get("results") or []


def list_migration_files() -> list[str]:
    files = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    return files


def applied_names() -> set[str]:
    rows = wrangler_json("SELECT name FROM d1_migrations")
    return {r["name"] for r in rows if r.get("name")}


def remote_tables_and_indexes() -> tuple[set[str], set[str]]:
    rows = wrangler_json(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','index')"
    )
    tables: set[str] = set()
    indexes: set[str] = set()
    for r in rows:
        name = r.get("name")
        if not name or name.startswith("sqlite_"):
            continue
        if r.get("type") == "table":
            tables.add(name)
        elif r.get("type") == "index":
            indexes.add(name)
    return tables, indexes


def table_columns(table: str) -> set[str]:
    # PRAGMA can't be parameterized; table names come only from our SQL files.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
        raise SystemExit(f"refusing unsafe table name: {table}")
    rows = wrangler_json(f"PRAGMA table_info({table})")
    return {r["name"] for r in rows if r.get("name")}


CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\"]?(\w+)[`\"]?",
    re.IGNORECASE,
)
CREATE_INDEX_RE = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\"]?(\w+)[`\"]?",
    re.IGNORECASE,
)
ALTER_ADD_RE = re.compile(
    r"ALTER\s+TABLE\s+[`]?(\w+)[`]?\s+ADD\s+(?:COLUMN\s+)?[`]?(\w+)[`]?",
    re.IGNORECASE,
)


def migration_fully_present(sql: str, tables: set[str], indexes: set[str]) -> bool:
    needed_tables = CREATE_TABLE_RE.findall(sql)
    needed_indexes = CREATE_INDEX_RE.findall(sql)
    alters = ALTER_ADD_RE.findall(sql)

    for t in needed_tables:
        if t not in tables:
            return False
    for i in needed_indexes:
        if i not in indexes:
            return False
    for table, col in alters:
        if table not in tables:
            return False
        cols = table_columns(table)
        if col not in cols:
            return False
    # Empty / comment-only migrations shouldn't auto-stamp.
    if not needed_tables and not needed_indexes and not alters:
        return False
    return True


def stamp(name: str) -> None:
    # Escape single quotes for SQL literal.
    safe = name.replace("'", "''")
    wrangler_json(
        f"INSERT OR IGNORE INTO d1_migrations (name) VALUES ('{safe}')"
    )
    print(f"stamped as applied: {name}")


def main() -> int:
    applied = applied_names()
    tables, indexes = remote_tables_and_indexes()
    print(f"remote applied: {sorted(applied)}")
    print(f"remote tables: {len(tables)} indexes: {len(indexes)}")

    stamped = 0
    for name in list_migration_files():
        if name in applied:
            continue
        sql = (MIGRATIONS_DIR / name).read_text(encoding="utf-8")
        if migration_fully_present(sql, tables, indexes):
            stamp(name)
            stamped += 1
            applied.add(name)
        else:
            print(f"pending (will apply): {name}")

    print(f"done — stamped {stamped} already-present migration(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
