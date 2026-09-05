/**
 * Builds a compact, visibility-filtered snapshot of the caller's family
 * so the assistant can answer "what's going on?" without extra round-trips.
 * Private documents the caller cannot see are omitted (never 403'd — they
 * simply aren't in the prompt).
 */
import { and, asc, desc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { fromCents } from "./expenses";

const DOC_LIMIT = 40;
const TASK_LIMIT = 40;
const EVENT_LIMIT = 20;
const EXPENSE_LIMIT = 50;

export interface FamilySnapshot {
  today: string;
  you: {
    userId: string;
    name: string | null;
    email: string;
    role: string;
  };
  family: { id: string; name: string };
  members: {
    id: string;
    name: string;
    role: string;
    memberType: string;
    dateOfBirth: string | null;
  }[];
  documents: {
    id: string;
    title: string;
    category: string;
    expiryDate: string | null;
    visibility: string;
  }[];
  openTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    assignedToMemberId: string | null;
  }[];
  upcomingEvents: {
    id: string;
    title: string;
    startAt: number;
    type: string;
    location: string | null;
  }[];
  recentExpenses: {
    id: string;
    amount: number;
    currency: string;
    category: string;
    note: string | null;
    spentOn: string;
  }[];
  stats: {
    documentCount: number;
    expiringWithin30Days: number;
    openTaskCount: number;
    overdueTaskCount: number;
    upcomingEventCount: number;
    expenseTotalThisMonth: number;
    expenseCountThisMonth: number;
  };
}

function todayIso(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function monthStartIso(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function loadFamilySnapshot(
  db: Db,
  opts: { familyId: string; userId: string; role: string },
  nowMs = Date.now(),
): Promise<FamilySnapshot | null> {
  const { familyId, userId, role } = opts;
  const today = todayIso(nowMs);
  const nowSecs = Math.floor(nowMs / 1000);
  const horizonSecs = nowSecs + 60 * 86_400;

  const family = await db
    .select({ id: schema.families.id, name: schema.families.name })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();
  if (!family) return null;

  const you = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!you) return null;

  const memberRows = await db
    .select({
      id: schema.familyMembers.id,
      role: schema.familyMembers.role,
      memberType: schema.familyMembers.memberType,
      displayName: schema.familyMembers.displayName,
      dateOfBirth: schema.familyMembers.dateOfBirth,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.familyMembers)
    .leftJoin(schema.users, eq(schema.familyMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.familyMembers.familyId, familyId),
        eq(schema.familyMembers.status, "active"),
      ),
    );

  const members = memberRows.map((m) => ({
    id: m.id,
    name: m.displayName || m.userName || m.userEmail || "Member",
    role: m.role,
    memberType: m.memberType,
    dateOfBirth: m.dateOfBirth,
  }));

  const visibility =
    role === "owner" || role === "admin"
      ? and(
          eq(schema.documents.familyId, familyId),
          ne(schema.documents.status, "trashed"),
        )
      : and(
          eq(schema.documents.familyId, familyId),
          ne(schema.documents.status, "trashed"),
          or(
            eq(schema.documents.visibility, "family"),
            eq(schema.documents.ownerUserId, userId),
          ),
        );

  const documents = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      category: schema.documents.category,
      expiryDate: schema.documents.expiryDate,
      visibility: schema.documents.visibility,
    })
    .from(schema.documents)
    .where(visibility)
    .orderBy(desc(schema.documents.updatedAt))
    .limit(DOC_LIMIT);

  const openTasks = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      assignedToMemberId: schema.tasks.assignedToMemberId,
    })
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.familyId, familyId), eq(schema.tasks.status, "open")),
    )
    .orderBy(asc(schema.tasks.dueDate), desc(schema.tasks.createdAt))
    .limit(TASK_LIMIT);

  const upcomingEvents = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startAt: schema.events.startAt,
      type: schema.events.type,
      location: schema.events.location,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.familyId, familyId),
        eq(schema.events.status, "active"),
        gte(schema.events.startAt, nowSecs - 86_400),
        lte(schema.events.startAt, horizonSecs),
      ),
    )
    .orderBy(asc(schema.events.startAt))
    .limit(EVENT_LIMIT);

  const recentExpenses = await db
    .select({
      id: schema.expenses.id,
      amountCents: schema.expenses.amountCents,
      currency: schema.expenses.currency,
      category: schema.expenses.category,
      note: schema.expenses.note,
      spentOn: schema.expenses.spentOn,
    })
    .from(schema.expenses)
    .where(eq(schema.expenses.familyId, familyId))
    .orderBy(desc(schema.expenses.spentOn), desc(sql`"expenses".rowid`))
    .limit(EXPENSE_LIMIT);

  const monthStart = monthStartIso(nowMs);
  const monthRows = await db
    .select({
      amountCents: schema.expenses.amountCents,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.familyId, familyId),
        gte(schema.expenses.spentOn, monthStart),
        lte(schema.expenses.spentOn, today),
      ),
    );

  const horizon30 = new Date(nowMs + 30 * 86_400_000).toISOString().slice(0, 10);
  const expiringWithin30Days = documents.filter(
    (d) => d.expiryDate && d.expiryDate <= horizon30,
  ).length;
  const overdueTaskCount = openTasks.filter(
    (t) => t.dueDate && t.dueDate < today,
  ).length;

  return {
    today,
    you: { ...you, role },
    family,
    members,
    documents,
    openTasks,
    upcomingEvents,
    recentExpenses: recentExpenses.map((e) => ({
      id: e.id,
      amount: fromCents(e.amountCents),
      currency: e.currency,
      category: e.category,
      note: e.note,
      spentOn: e.spentOn,
    })),
    stats: {
      documentCount: documents.length,
      expiringWithin30Days,
      openTaskCount: openTasks.length,
      overdueTaskCount,
      upcomingEventCount: upcomingEvents.length,
      expenseTotalThisMonth: fromCents(
        monthRows.reduce((s, r) => s + r.amountCents, 0),
      ),
      expenseCountThisMonth: monthRows.length,
    },
  };
}
