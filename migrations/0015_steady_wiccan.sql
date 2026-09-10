PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminder_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`push_enabled` integer DEFAULT false NOT NULL,
	`windows_json` text DEFAULT '[30,7,2,0]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reminder_prefs`("user_id", "email_enabled", "push_enabled", "windows_json") SELECT "user_id", "email_enabled", "push_enabled", "windows_json" FROM `reminder_prefs`;--> statement-breakpoint
DROP TABLE `reminder_prefs`;--> statement-breakpoint
ALTER TABLE `__new_reminder_prefs` RENAME TO `reminder_prefs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Upgrade the legacy shipped default so existing Settings saves get day-of + 2d.
UPDATE `reminder_prefs` SET `windows_json` = '[30,7,2,0]' WHERE `windows_json` IN ('[30,7,1]', '[1,7,30]', '[30, 7, 1]');--> statement-breakpoint
ALTER TABLE `documents` ADD `calendar_reminder_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `expiry_reminder_event_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `source` text;
