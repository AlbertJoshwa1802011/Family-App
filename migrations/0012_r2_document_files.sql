PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`storage_provider` text DEFAULT 'r2' NOT NULL,
	`r2_key` text,
	`drive_file_id` text,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Copy only columns that exist on the old table. Legacy Drive uploads become
-- storage_provider='drive'; new R2 uploads use the column default 'r2'.
INSERT INTO `__new_files`("id", "document_id", "storage_provider", "r2_key", "drive_file_id", "file_name", "mime_type", "size_bytes", "version", "is_current", "status", "deleted_at", "created_at") SELECT "id", "document_id", 'drive', NULL, "drive_file_id", "file_name", "mime_type", "size_bytes", "version", "is_current", "status", "deleted_at", "created_at" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_file_doc_current` ON `files` (`document_id`,`is_current`);
