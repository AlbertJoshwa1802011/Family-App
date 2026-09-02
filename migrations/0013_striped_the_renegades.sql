CREATE TABLE `device_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key_jwk` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_credentials_credential_id_unique` ON `device_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_device_cred_user` ON `device_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `device_pins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `google_resource_name` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `google_etag` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `last_pushed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contact_google_resource` ON `contacts` (`family_id`,`google_resource_name`);