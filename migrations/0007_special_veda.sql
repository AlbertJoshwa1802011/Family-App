CREATE TABLE `document_extracts` (
	`document_id` text PRIMARY KEY NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`text` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_extract_status` ON `document_extracts` (`status`);