/**
 * Resolve the mailbox that should receive reminder emails.
 * When reminder_prefs.reminderEmail is set, it overrides users.email.
 */
export function resolveReminderRecipientEmail(
  reminderEmail: string | null | undefined,
  accountEmail: string,
): string {
  const override = reminderEmail?.trim();
  return override && override.length > 0 ? override : accountEmail;
}
