/**
 * Family assistant — Claude + D1 context + tools.
 *
 * The model is given a visibility-filtered snapshot of the caller's family
 * plus a catalogue of every in-app surface, then allowed to call tools that
 * write through the same tables as the REST API. No Drive bytes, no other
 * families, no secrets ever enter the prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam, TextBlock, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import type { Env } from "../types";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { and, desc, eq, sql } from "drizzle-orm";
import { loadFamilySnapshot } from "./assistantContext";
import {
  ASSISTANT_TOOLS,
  executeAssistantTool,
  type ToolAction,
  type ToolContext,
} from "./assistantTools";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 16;

export function isAssistantConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export interface AssistantTurn {
  reply: string;
  actions: ToolAction[];
}

export type CompleteFn = (args: {
  system: string;
  tools: typeof ASSISTANT_TOOLS;
  messages: MessageParam[];
}) => Promise<Message>;

const APP_GUIDE = `You are Family Vault's in-app assistant. You know THIS family because a live database snapshot is provided below. Answer from that snapshot. Never invent documents, people, dates, or balances that aren't in it.

What this app is
Family Vault is a mobile-first PWA for one household. Documents (passports, insurance, licences, medical, warranties) live as files in the family owner's Google Drive. Metadata, tasks, events, expenses, chat, and reminders live in Cloudflare D1. You do NOT have access to file bytes — only document titles, categories, and expiry dates the caller is allowed to see.

Screens (so you can point people to the right place)
- Home / Dashboard (\`/\`) — stats, upcoming expiries, events, quick access
- Documents (\`/documents\`) — list, search, upload, expiry badges. Private docs are only visible to the owner + admins.
- Document detail (\`/documents/:id\`) — versions, download, comments, "remind a member"
- Calendar (\`/calendar\`) — family events. Types: gathering, appointment, milestone, other. Status active/cancelled/trashed are orthogonal.
- Tasks (\`/tasks\`) — to-dos with optional due date. Daily cron emails at 7, 2, and 1 days before due (and overdue).
- Contacts (\`/contacts\`) — emergency / useful numbers
- Expenses (\`/expenses\`) — family spending log
- Family chat (\`/chat\`) — members only; @mentions notify
- Activity (\`/notifications\`) — in-app inbox + email reminder prefs (Settings)
- Family (\`/family\`) — members, invites, dependents, activity feed
- Settings (\`/settings\`) — reminder channels and lead-time windows (documents/events: 30/7/1 by default)
- Assistant (\`/assistant\`) — this conversation, private to the signed-in user

Storage (if asked about Google buckets)
Documents are stored in the owner's Google Drive (drive.file scope), not Google Cloud Storage. GCS would need a GCP project and billed buckets; Drive is the family's existing 5 TB. Structured data (including expenses) is in D1, which is what you read.

How to help
- Questions: answer from the snapshot. Quote names, dates, amounts. Offer a short stats recap when useful (open tasks, expiring docs, this-month spend).
- Operations: CALL A TOOL. Do not claim you added something unless the tool returned ok. Examples:
  "add 100 for outside snacks" → add_expense amount=100, category=food, note="outside snacks"
  "remind me to renew the visa in 7 days" → add_task with a dueDate 7 days from today
  "mark pick up prescriptions done" → complete_task with the matching id
- After a successful write, briefly confirm what you did and mention the 7/2/1-day email reminder if you created a dated task.
- If a tool fails, say so and suggest the matching screen.
- Never reveal private documents that are not in the snapshot. Never mention API keys, cookies, or other families.
- Be concise, warm, and specific. Use the family's currency symbol when talking money.
- Today (UTC) is in the snapshot. Dates in the app are ISO yyyy-mm-dd.`;

async function defaultComplete(
  env: Env,
  args: { system: string; tools: typeof ASSISTANT_TOOLS; messages: MessageParam[] },
): Promise<Message> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
    tools: args.tools,
    messages: args.messages,
  });
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function loadAssistantHistory(
  db: Db,
  familyId: string,
  userId: string,
): Promise<{ id: string; role: "user" | "assistant"; body: string; createdAt: number; actions: ToolAction[] | null }[]> {
  const rows = await db
    .select({
      id: schema.assistantMessages.id,
      role: schema.assistantMessages.role,
      body: schema.assistantMessages.body,
      createdAt: schema.assistantMessages.createdAt,
      actionsJson: schema.assistantMessages.actionsJson,
    })
    .from(schema.assistantMessages)
    .where(
      and(
        eq(schema.assistantMessages.familyId, familyId),
        eq(schema.assistantMessages.userId, userId),
      ),
    )
    .orderBy(desc(schema.assistantMessages.createdAt), desc(sql`"assistant_messages".rowid`))
    .limit(HISTORY_LIMIT);

  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    body: r.body,
    createdAt: r.createdAt,
    actions: r.actionsJson ? (JSON.parse(r.actionsJson) as ToolAction[]) : null,
  }));
}

export async function runAssistantTurn(opts: {
  env: Env;
  db: Db;
  familyId: string;
  userId: string;
  role: string;
  message: string;
  complete?: CompleteFn;
  nowMs?: number;
}): Promise<AssistantTurn> {
  const nowMs = opts.nowMs ?? Date.now();
  const snapshot = await loadFamilySnapshot(
    opts.db,
    { familyId: opts.familyId, userId: opts.userId, role: opts.role },
    nowMs,
  );
  if (!snapshot) {
    return { reply: "I couldn't load this family right now. Try again in a moment.", actions: [] };
  }

  const history = await loadAssistantHistory(opts.db, opts.familyId, opts.userId);
  const messages: MessageParam[] = [];
  for (const h of history) {
    messages.push({ role: h.role, content: h.body });
  }
  messages.push({ role: "user", content: opts.message });

  const system = `${APP_GUIDE}\n\nLive family snapshot (JSON):\n${JSON.stringify(snapshot)}`;
  const complete = opts.complete ?? ((args) => defaultComplete(opts.env, args));
  const toolCtx: ToolContext = {
    db: opts.db,
    familyId: opts.familyId,
    userId: opts.userId,
    role: opts.role,
    nowMs,
  };

  const actions: ToolAction[] = [];
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await complete({ system, tools: ASSISTANT_TOOLS, messages });
    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (toolUses.length === 0) {
      reply = textOf(response) || "Done.";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: MessageParam["content"] = [];
    for (const use of toolUses) {
      const result = await executeAssistantTool(use.name, use.input, toolCtx);
      if (result.action) actions.push(result.action);
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });

    if (round === MAX_TOOL_ROUNDS - 1) {
      // Force a closing reply without further tools.
      const closing = await complete({
        system,
        tools: [],
        messages,
      });
      reply = textOf(closing) || (actions[0]?.summary ?? "Done.");
    }
  }

  if (!reply) {
    reply =
      actions.length > 0
        ? actions.map((a) => a.summary).join(" ")
        : "I wasn't able to finish that. Please try again.";
  }

  return { reply, actions };
}
