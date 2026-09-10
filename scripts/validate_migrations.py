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

EXPECTED_MIN_TABLES = 50  # bump when you add tables


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

    # Mirror ensure_money_schema for the feature→rich expenses transition.
    fam_cols = {r[1] for r in db.execute("PRAGMA table_info(families)")}
    if "default_currency" not in fam_cols:
        db.execute("ALTER TABLE families ADD COLUMN default_currency text NOT NULL DEFAULT 'USD'")
    exp_cols = {r[1] for r in db.execute("PRAGMA table_info(expenses)")}
    if "amount_minor" not in exp_cols and "amount_cents" in exp_cols:
        db.execute("ALTER TABLE expenses RENAME TO expenses_legacy_simple")
        db.executescript("""
        CREATE TABLE expenses (
          id text PRIMARY KEY NOT NULL,
          family_id text NOT NULL,
          paid_by_member_id text NOT NULL,
          subject_member_id text,
          category_id text,
          parent_expense_id text,
          nest_depth integer DEFAULT 0 NOT NULL,
          amount_minor integer NOT NULL,
          currency text NOT NULL,
          expense_date text NOT NULL,
          merchant text,
          description text,
          payment_method text,
          split_type text DEFAULT 'none' NOT NULL,
          visibility text DEFAULT 'family' NOT NULL,
          status text DEFAULT 'active' NOT NULL,
          trashed_at integer,
          created_by_user_id text NOT NULL,
          client_request_id text,
          created_at integer DEFAULT (unixepoch()) NOT NULL,
          updated_at integer DEFAULT (unixepoch()) NOT NULL
        );
        """)
        db.execute("""
        INSERT INTO expenses (
          id, family_id, paid_by_member_id, amount_minor, currency, expense_date,
          description, visibility, status, created_by_user_id, created_at, updated_at, nest_depth, split_type
        )
        SELECT
          e.id, e.family_id, fm.id, e.amount_cents, e.currency, e.spent_on,
          e.note, 'family', 'active', e.created_by, e.created_at, e.updated_at, 0, 'none'
        FROM expenses_legacy_simple e
        JOIN family_members fm
          ON fm.family_id = e.family_id AND fm.user_id = e.created_by
        """)
        print("OK   ensure_rich_expenses (copied from simple)")

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
