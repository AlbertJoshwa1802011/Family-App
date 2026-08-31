#!/usr/bin/env python3
"""
Validate that all Drizzle migrations apply cleanly, in order, to a fresh SQLite DB.

Run:  python3 scripts/validate_migrations.py

This catches the common drizzle-kit table-recreation bug where an
`INSERT ... SELECT` references columns that don't exist on the old table yet.
CI / future agents should run this after every `npm run db:generate`.
Exit code 0 = all migrations valid; non-zero = a migration failed.
"""
import sqlite3
import glob
import os
import sys

EXPECTED_MIN_TABLES = 41  # bump when you add tables


def main() -> int:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON;")
    files = sorted(glob.glob("migrations/*.sql"))
    if not files:
        print("No migrations found (run from repo root).")
        return 1

    for f in files:
        sql = open(f).read()
        stmts = sql.split("--> statement-breakpoint")
        try:
            for s in stmts:
                s = s.strip()
                if s:
                    db.executescript(s)
            print(f"OK   {os.path.basename(f)}")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {os.path.basename(f)}: {e}")
            return 1

    tables = [
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    ]
    print(f"\n{len(tables)} tables created.")
    if len(tables) < EXPECTED_MIN_TABLES:
        print(
            f"WARNING: expected >= {EXPECTED_MIN_TABLES} tables, got {len(tables)}."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
