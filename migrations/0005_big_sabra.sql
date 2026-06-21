CREATE TABLE `storage_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'google_drive' NOT NULL,
	`email` text,
	`root_folder_id` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`connected_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
