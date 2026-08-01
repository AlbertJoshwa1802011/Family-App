/**
 * Drizzle schema — the SINGLE SOURCE OF TRUTH for the database.
 * SQL migrations are generated from this via `npm run db:generate` (drizzle-kit) and
 * applied to D1 with `wrangler d1 migrations apply`. Do not hand-edit migrations to add
 * columns; change the schema here and regenerate.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  createdAt: integer("created_at").notNull().default(now),
  lastLoginAt: integer("last_login_at"),
});

export const families = sqliteTable("families", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  driveFolderId: text("drive_folder_id"),
  createdAt: integer("created_at").notNull().default(now),
});

export const familyMembers = sqliteTable(
  "family_members",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // NULLABLE: dependents (children, elderly relatives) have no Google account.
    // For memberType='dependent', userId is null and displayName is used instead.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    // memberType distinguishes a real authenticated user from a managed dependent.
    memberType: text("member_type", { enum: ["user", "dependent"] })
      .notNull()
      .default("user"),
    // Used when userId is null (dependent). For 'user' members the name comes from users.name.
    displayName: text("display_name"),
    dateOfBirth: text("date_of_birth"), // ISO yyyy-mm-dd, optional (useful for children)
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    status: text("status", { enum: ["active", "invited", "removed"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    // NULLs are distinct in SQLite unique indexes, so multiple dependents
    // (userId=null) can coexist in one family while real users stay unique.
    unique("uq_family_user").on(t.familyId, t.userId),
    index("idx_member_user").on(t.userId),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Store only the HASH of the invite token (treat like a password).
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_invite_email").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    userAgent: text("user_agent"),
  },
  (t) => [index("idx_session_expires").on(t.expiresAt)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("other"),
    subjectMemberId: text("subject_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    description: text("description"),
    expiryDate: text("expiry_date"), // ISO yyyy-mm-dd
    issuedDate: text("issued_date"),
    currentFileId: text("current_file_id"),
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_doc_family_expiry").on(t.familyId, t.expiryDate),
    index("idx_doc_family_status").on(t.familyId, t.status),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    driveFileId: text("drive_file_id").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    version: integer("version").notNull().default(1),
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", { enum: ["active", "deleted"] })
      .notNull()
      .default("active"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_file_doc_current").on(t.documentId, t.isCurrent)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [unique("uq_family_tag").on(t.familyId, t.name)],
);

export const documentTags = sqliteTable(
  "document_tags",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.tagId] }),
    index("idx_doctag_tag").on(t.tagId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_notif_user_read").on(t.userId, t.read, t.createdAt)],
);

export const remindersLog = sqliteTable(
  "reminders_log",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_reminder").on(t.documentId, t.userId, t.windowDays, t.channel),
  ],
);

export const reminderPrefs = sqliteTable("reminder_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  windowsJson: text("windows_json").notNull().default("[30,7,1]"),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  familyId: text("family_id").references(() => families.id, {
    onDelete: "cascade",
  }),
  actorUserId: text("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  meta: text("meta"),
  createdAt: integer("created_at").notNull().default(now),
});

// ── Calendar / Events ────────────────────────────────────────────────────────

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: integer("start_at").notNull(), // unix timestamp (seconds)
    endAt: integer("end_at"), // null = single-instant / all-day
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    location: text("location"),
    // type = what kind of event (gathering, appointment, milestone, other)
    type: text("type", {
      enum: ["gathering", "appointment", "milestone", "other"],
    })
      .notNull()
      .default("other"),
    // status = lifecycle (soft-delete and cancel are separate from type)
    status: text("status", { enum: ["active", "cancelled", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_event_family_start").on(t.familyId, t.startAt),
    index("idx_event_family_status_start").on(t.familyId, t.status, t.startAt),
  ],
);

// Members tagged as attendees/participants for an event.
export const eventAttendees = sqliteTable(
  "event_attendees",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

// Documents linked to an event (e.g. insurance card linked to a hospital visit).
export const eventDocuments = sqliteTable(
  "event_documents",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.documentId] })],
);

// Deduplicate event reminders (parallel to reminders_log for documents).
export const eventRemindersLog = sqliteTable(
  "event_reminders_log",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_event_reminder").on(
      t.eventId,
      t.userId,
      t.windowDays,
      t.channel,
    ),
  ],
);

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    assignedToMemberId: text("assigned_to_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    dueDate: text("due_date"), // ISO yyyy-mm-dd; null = no deadline
    status: text("status", { enum: ["open", "done", "archived"] })
      .notNull()
      .default("open"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relatedDocumentId: text("related_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    relatedEventId: text("related_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_task_family_status").on(t.familyId, t.status),
    index("idx_task_assignee").on(t.assignedToMemberId),
  ],
);

// ── Emergency Contacts ───────────────────────────────────────────────────────

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: text("relationship"), // Doctor, School, Plumber, …
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("idx_contact_family").on(t.familyId)],
);

// ── Member Health Notes ──────────────────────────────────────────────────────

export const memberHealth = sqliteTable("member_health", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => familyMembers.id, { onDelete: "cascade" }),
  bloodType: text("blood_type"),
  allergies: text("allergies"), // free-text (or comma-separated list)
  medications: text("medications"),
  doctorName: text("doctor_name"),
  doctorPhone: text("doctor_phone"),
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull().default(now),
});

// ── Document Comments ────────────────────────────────────────────────────────

export const documentComments = sqliteTable(
  "document_comments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("idx_comment_doc").on(t.documentId, t.createdAt)],
);

// ── Family Chat ──────────────────────────────────────────────────────────────
// One shared conversation per family. Soft-delete keeps thread continuity
// ("message deleted" placeholder) and preserves the audit trail.

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("idx_chat_family_created").on(t.familyId, t.createdAt)],
);

// ── Digest Log ───────────────────────────────────────────────────────────────
// Dedupe for the weekly email digest: one row per (user, ISO week) sent.

export const digestLog = sqliteTable(
  "digest_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(), // e.g. "2026-W27"
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [uniqueIndex("uq_digest_user_period").on(t.userId, t.periodKey)],
);

// ── Expense Intelligence ─────────────────────────────────────────────────────
// See docs/EXPENSES_ARCHITECTURE.md. Four tables in V1; tags, accounts, budgets,
// recurring expenses and the raw-transaction staging layer attach later as new
// tables or nullable columns, never as a rewrite of these.

/**
 * Categories AND subcategories live in one self-referencing table, capped at
 * depth 2 (a row with a parent_id may not itself be a parent — enforced in app
 * code + tested). One table because both levels carry identical fields and
 * identical CRUD; drill-down analytics is a self-join.
 *
 * Rows are seeded per family (see worker/lib/expenses/defaults.ts) so every
 * category is fully user-editable — no global/system rows leaking across
 * families and no `family_id IS NULL` special case in every query.
 *
 * Categories are ARCHIVED, never deleted: historical expenses must stay
 * analyzable. `expenses.category_id` therefore has no ON DELETE action.
 */
export const expenseCategories = sqliteTable(
  "expense_categories",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // NULL = top-level category; set = subcategory of that category.
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => expenseCategories.id,
      { onDelete: "cascade" },
    ),
    name: text("name").notNull(),
    // Stable key used for idempotent seeding and for "reset to defaults".
    // Child slugs are parent-prefixed (e.g. "food-groceries") so one namespace
    // per family is collision-free.
    slug: text("slug").notNull(),
    emoji: text("emoji"),
    // Palette slug (e.g. "amber"), NOT a raw hex — the frontend maps it to
    // static Tailwind classes so the theme stays coherent. NULL on a
    // subcategory means "inherit the parent's colour".
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Seeded row: may be renamed/re-emoji'd/archived, but never hard-deleted.
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    unique("uq_expcat_family_slug").on(t.familyId, t.slug),
    index("idx_expcat_family_parent").on(t.familyId, t.parentId, t.sortOrder),
    index("idx_expcat_family_status").on(t.familyId, t.status),
  ],
);

/**
 * Payment methods are data-driven so a family can add "PhonePe" without a code
 * change. `kind` is the coarse, stable dimension analytics groups by — never
 * match on `name`. Accounts (e.g. "HDFC Credit Card ••1234") are a later table;
 * this stays the payment *type*.
 */
export const expensePaymentMethods = sqliteTable(
  "expense_payment_methods",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", {
      enum: ["cash", "card", "bank", "upi", "wallet", "other"],
    })
      .notNull()
      .default("other"),
    emoji: text("emoji"),
    sortOrder: integer("sort_order").notNull().default(0),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    unique("uq_exppm_family_slug").on(t.familyId, t.slug),
    index("idx_exppm_family_status").on(t.familyId, t.sortOrder),
  ],
);

/**
 * A classified unit of SPENDING — deliberately not a general financial ledger.
 * A future bank/card sync stores raw transactions in their own table and only
 * materializes an `expenses` row for the kinds that actually represent spending
 * (see worker/lib/expenses/types.ts). Transfers between the family's own
 * accounts and credit-card bill payments must never land here, or they would
 * double-count against the purchases already imported.
 *
 * MONEY: `amount_minor` is an INTEGER in the currency's minor units (paise,
 * cents). Never store money as REAL — SQLite float sums drift and D1 has no
 * DECIMAL. Every aggregation is an integer SUM() grouped BY currency; V1 does
 * no conversion and never silently mixes currencies.
 *
 * V1 keeps amounts strictly positive (CHECK). Refunds/reversals are NOT
 * negative expenses — they get their own adjustment model later so that a
 * ₹2,000 purchase + ₹500 refund nets to ₹1,500 without corrupting the category
 * totals the purchase already contributed to.
 */
export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // Who recorded it — always derived from the session, never from the client.
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Who actually paid — deliberately separate from created_by_user_id (a
    // parent records a dependent's expense) and from visibility. Nullable:
    // attribution is optional. Points at family_members so dependents (who have
    // no user account) can be attributed too.
    payerMemberId: text("payer_member_id").references(() => familyMembers.id, {
      onDelete: "set null",
    }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("INR"), // ISO-4217
    // The CALENDAR date the money was spent — never assume this equals
    // created_at (historical entries and imports backdate freely).
    spentOn: text("spent_on").notNull(), // ISO yyyy-mm-dd
    spentTime: text("spent_time"), // optional "HH:MM", local wall-clock
    // Denormalized parent + child so GROUP BY stays index-friendly. Invariant:
    // subcategory_id's parent_id must equal category_id (enforced server-side).
    categoryId: text("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    subcategoryId: text("subcategory_id").references(
      () => expenseCategories.id,
    ),
    merchant: text("merchant"), // as typed by the user
    // Normalized merchant handle ("AMZN Mktp*IN" → "amzn mktp in"). The join
    // seam for merchant analytics today and for merchant aliases/rules later.
    merchantKey: text("merchant_key"),
    paymentMethodId: text("payment_method_id").references(
      () => expensePaymentMethods.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    // 'private' means CREATOR-ONLY — owners and admins do NOT see other
    // members' private expenses. This deliberately DIVERGES from documents
    // (where owner/admin see everything): financial privacy expectations differ
    // from document custodianship. Do not "fix" this for consistency; it is
    // pinned by tests/expenses-visibility.test.ts.
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    // Provenance. Analytics must never assume manual entry.
    source: text("source", {
      enum: ["manual", "csv_import", "bank_sync", "api", "system"],
    })
      .notNull()
      .default("manual"),
    externalId: text("external_id"), // provider transaction id
    externalAccount: text("external_account"), // provider account handle
    importBatchId: text("import_batch_id"), // reserved for the importer
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    // Every range query starts here.
    index("idx_exp_family_date").on(t.familyId, t.spentOn),
    // List + soft-delete filtering.
    index("idx_exp_family_status_date").on(t.familyId, t.status, t.spentOn),
    // Category breakdowns and drill-down.
    index("idx_exp_family_cat_date").on(t.familyId, t.categoryId, t.spentOn),
    // Merchant ranking + "what did this family last use for this merchant".
    index("idx_exp_family_merchant").on(t.familyId, t.merchantKey),
    // Import de-duplication, enforced by the database before the importer that
    // needs it exists. PARTIAL: manual rows (external_id NULL) are unaffected.
    uniqueIndex("uq_exp_external")
      .on(t.familyId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    // V1 invariant: expenses are strictly positive. See the table comment.
    check("ck_exp_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/** Per-family expense preferences. */
export const expenseSettings = sqliteTable("expense_settings", {
  familyId: text("family_id")
    .primaryKey()
    .references(() => families.id, { onDelete: "cascade" }),
  // Default for new expenses. Configurable — INR is the default, not a
  // hard-coded assumption.
  defaultCurrency: text("default_currency").notNull().default("INR"),
  weekStartsOn: integer("week_starts_on").notNull().default(1), // 0=Sun … 1=Mon
  // Supports salary-cycle periods later (1–28 to stay valid in every month).
  monthStartDay: integer("month_start_day").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});
