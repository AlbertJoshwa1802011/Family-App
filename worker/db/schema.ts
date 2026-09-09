/**
 * Drizzle schema — the SINGLE SOURCE OF TRUTH for the database.
 * SQL migrations are generated from this via `npm run db:generate` (drizzle-kit) and
 * applied to D1 with `wrangler d1 migrations apply`. Do not hand-edit migrations to add
 * columns; change the schema here and regenerate.
 */
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    /**
     * JSON array of enabled FamilyModule ids. NULL = all modules (default).
     * Owners always have full access regardless of this column.
     */
    modulesJson: text("modules_json"),
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
    /** Preset module access applied when the invite is accepted. NULL = all. */
    modulesJson: text("modules_json"),
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
    // When true, Family Vault upserts a calendar marker ~7 days before expiry
    // (family-visible docs → in-app event + ICS; private → owner ICS only).
    calendarReminderEnabled: integer("calendar_reminder_enabled", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    // Linked system event for family-visible calendar reminders (nullable).
    expiryReminderEventId: text("expiry_reminder_event_id"),
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
  // Day-of (0) is required so "expires today" is a distinct dedupe slot from
  // lead-time windows. App code also upgrades the legacy "[30,7,1]" default.
  windowsJson: text("windows_json").notNull().default("[30,7,2,0]"),
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
    // Advisory travel buffer (minutes before start). UI can show "leave by";
    // no Maps API required — members set this themselves.
    travelBufferMins: integer("travel_buffer_mins"),
    // type = what kind of event. Built-ins: gathering|appointment|milestone|other.
    // Families may add custom slugs via `family_labels` (domain=event_type).
    type: text("type").notNull().default("other"),
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
    // Monotonic edit counter for optimistic concurrency. updatedAt cannot serve
    // this: it has one-second granularity, so two members saving within the
    // same second would both appear to hold the current version.
    version: integer("version").notNull().default(1),
    // Null for user-created events. `document_expiry` = system renew marker
    // linked from documents.expiry_reminder_event_id (skipped by event cron
    // so email reminders aren't doubled with the document expiry pipeline).
    source: text("source"),
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
    // Attendance is a state, not just a tag: being invited is not the same as
    // coming. Dependents (no Google account) are seeded 'accepted' — a small
    // child does not RSVP, their guardian answers for them.
    rsvp: text("rsvp", {
      enum: ["invited", "accepted", "declined", "tentative"],
    })
      .notNull()
      .default("invited"),
    rsvpAt: integer("rsvp_at"),
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

/**
 * Maps a Family Vault event → each user's Google Calendar event.
 * The app is the source of truth: create/update/cancel in D1 pushes here
 * via the Calendar API (best-effort; missing refresh tokens / scopes skip).
 */
export const eventGoogleSync = sqliteTable(
  "event_google_sync",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    syncedAt: integer("synced_at").notNull().default(now),
  },
  (t) => [
    unique("uq_event_google_sync_user").on(t.eventId, t.userId),
    index("idx_event_google_sync_event").on(t.eventId),
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
    // Nested subtasks. Root tasks have parentTaskId = null. Depth is capped in
    // app code (MAX_TASK_DEPTH) because D1 cannot enforce a graph constraint.
    parentTaskId: text("parent_task_id").references(
      (): AnySQLiteColumn => tasks.id,
      { onDelete: "cascade" },
    ),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    // Set when status becomes "done"; cleared on reopen. Used by the Completed view.
    completedAt: integer("completed_at"),
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
    index("idx_task_parent").on(t.parentTaskId),
    index("idx_task_family_created").on(t.familyId, t.createdAt),
    index("idx_task_family_priority").on(t.familyId, t.priority),
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

// ── Notebooks & Notes (Apple Notes–style) ────────────────────────────────────
// Folders (`notebooks`) + free-form notes for daily journaling, Bible study,
// etc. Visibility mirrors documents: private notes are owner/admin-only;
// family notes are shared with every active member. Soft-delete via deletedAt
// (Recently Deleted). D1 cascades are advisory — deleting a notebook must
// explicitly null out notes.notebook_id in app code.

// Built-in note kinds (defaults). Families may add custom slugs via
// `family_labels` (domain=note_kind); the column itself is free text.
export const NOTE_KINDS = ["general", "bible", "journal", "meeting", "other"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Domains that support family-defined labels (type/category chips + emoji). */
export const LABEL_DOMAINS = [
  "event_type",
  "document_category",
  "expense_category",
  "note_kind",
  "contact_relationship",
] as const;
export type LabelDomain = (typeof LABEL_DOMAINS)[number];

/**
 * Family-scoped custom labels for type/category pickers.
 * Built-in defaults live in code (`worker/lib/labels.ts`); rows here are
 * user-created (or emoji/label overrides of a built-in slug).
 */
export const familyLabels = sqliteTable(
  "family_labels",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    domain: text("domain", { enum: LABEL_DOMAINS }).notNull(),
    // Value stored on the entity (events.type, documents.category, …).
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    // Optional emoji adornment shown on chips and badges.
    emoji: text("emoji"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_family_label_domain_slug").on(t.familyId, t.domain, t.slug),
    index("idx_family_label_domain").on(t.familyId, t.domain, t.sortOrder),
  ],
);

/** Attachable external refs (YouTube, web URL) or Drive photo docs. */
export const RESOURCE_LINK_KINDS = ["youtube", "url", "photo"] as const;
export type ResourceLinkKind = (typeof RESOURCE_LINK_KINDS)[number];
export const RESOURCE_LINK_TARGETS = ["event", "task", "note", "document"] as const;
export type ResourceLinkTarget = (typeof RESOURCE_LINK_TARGETS)[number];

export const notebooks = sqliteTable(
  "notebooks",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_notebook_family_sort").on(t.familyId, t.sortOrder),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // NULL = unfiled (All Notes / no folder).
    notebookId: text("notebook_id").references(() => notebooks.id, {
      onDelete: "set null",
    }),
    // Optional link to a calendar event (meeting notes). SET NULL on event delete.
    eventId: text("event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    kind: text("kind").notNull().default("general"),
    // Calendar date the note is about (daily / Bible study day), not an instant.
    noteDate: text("note_date"), // ISO yyyy-mm-dd
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("private"),
    pinned: integer("pinned").notNull().default(0), // 0|1
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("idx_note_family_updated").on(t.familyId, t.updatedAt),
    index("idx_note_notebook").on(t.notebookId),
    index("idx_note_family_owner").on(t.familyId, t.ownerUserId),
    index("idx_note_family_kind").on(t.familyId, t.kind),
    index("idx_note_event").on(t.eventId),
  ],
);

// External / media references attachable to family resources (YouTube, URL, photo doc).
export const resourceLinks = sqliteTable(
  "resource_links",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RESOURCE_LINK_KINDS }).notNull(),
    targetType: text("target_type", { enum: RESOURCE_LINK_TARGETS }).notNull(),
    targetId: text("target_id").notNull(),
    url: text("url"), // required for youtube|url; optional for photo
    title: text("title"),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }), // photo → vault document
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_resource_link_target").on(t.targetType, t.targetId),
    index("idx_resource_link_family").on(t.familyId, t.createdAt),
  ],
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

// ── Expenses ─────────────────────────────────────────────────────────────────
// Family spending log. Amount is stored in integer cents so we never do
// floating-point money math. "Add 100 for snacks" → 10000 cents of `currency`.

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("INR"),
    category: text("category").notNull().default("other"),
    note: text("note"),
    spentOn: text("spent_on").notNull(), // ISO yyyy-mm-dd
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("idx_expense_family_spent").on(t.familyId, t.spentOn)],
);

// ── Money settlements ────────────────────────────────────────────────────────
// Generic ledger for "fund in hand → settled to a destination".
// Destinations are family-scoped tracks (Mom, Church, landlord, …) — not
// separate pages. Balances are computed:
//   available = sum(received), settled = sum(settled), inHand = available − settled.

export const SETTLEMENT_DESTINATION_KINDS = [
  "person",
  "organization",
  "other",
] as const;

export const MONEY_MOVEMENT_TYPES = ["received", "settled"] as const;

export const settlementDestinations = sqliteTable(
  "settlement_destinations",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: SETTLEMENT_DESTINATION_KINDS })
      .notNull()
      .default("other"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Soft-archive keeps historical settlements readable under the old name.
    archivedAt: integer("archived_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("idx_settlement_dest_family").on(t.familyId, t.sortOrder)],
);

export const moneyMovements = sqliteTable(
  "money_movements",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // received → into the pot; settled → out to a destination.
    type: text("type", { enum: MONEY_MOVEMENT_TYPES }).notNull(),
    destinationId: text("destination_id").references(
      () => settlementDestinations.id,
      { onDelete: "restrict" },
    ),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("INR"),
    note: text("note"),
    movedOn: text("moved_on").notNull(), // ISO yyyy-mm-dd
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_money_movements_family_moved").on(t.familyId, t.movedOn),
    index("idx_money_movements_dest").on(t.destinationId, t.movedOn),
  ],
);

// ── Task reminder dedupe ─────────────────────────────────────────────────────
// Parallel to reminders_log / event_reminders_log. Daily cron fires at the
// tightest of [7, 2, 1] days before a task's due date (plus overdue).

export const taskRemindersLog = sqliteTable(
  "task_reminders_log",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_task_reminder").on(t.taskId, t.userId, t.windowDays, t.channel),
  ],
);

// ── Family assistant thread ──────────────────────────────────────────────────
// Per (family, user) conversation with the in-app AI. Soft-private: only the
// asking user reads their own thread. actions_json records tools the model
// actually ran (so the UI can show "Added expense · snacks · ₹100").

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    body: text("body").notNull(),
    actionsJson: text("actions_json"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_assistant_family_user_created").on(
      t.familyId,
      t.userId,
      t.createdAt,
    ),
  ],
);

// ── App-level access control (orthogonal to family_members.role) ─────────────
// Closed signup: strangers request a demo; a super_admin approves (email link
// or in-app). Approved emails land in access_grants. App roles (super_admin
// today; more later) live in app_role_assignments — never overload family roles.

/** Known app-level roles. Extensible: add values here as the team grows. */
export const APP_ROLES = ["super_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const demoRequests = sqliteTable(
  "demo_requests",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(), // stored lowercased
    company: text("company"),
    message: text("message"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    // Plain token emailed for approve/reject; only the hash is stored.
    reviewTokenHash: text("review_token_hash").notNull().unique(),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_demo_request_email").on(t.email),
    index("idx_demo_request_status_created").on(t.status, t.createdAt),
  ],
);

export const accessGrants = sqliteTable(
  "access_grants",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(), // lowercased
    status: text("status", { enum: ["approved", "revoked"] })
      .notNull()
      .default("approved"),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    demoRequestId: text("demo_request_id").references(() => demoRequests.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("idx_access_grant_status").on(t.status)],
);

export const appRoleAssignments = sqliteTable(
  "app_role_assignments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Free-form text so new roles can be added without a migration; validate
    // known roles in app code (see APP_ROLES / requireAppRole).
    role: text("role").notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_app_role_user").on(t.userId, t.role),
    index("idx_app_role_role").on(t.role),
  ],
);
