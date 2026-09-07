CREATE TABLE `demo_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_token_hash` text NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_requests_review_token_hash_unique` ON `demo_requests` (`review_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_demo_request_email` ON `demo_requests` (`email`);--> statement-breakpoint
CREATE INDEX `idx_demo_request_status_created` ON `demo_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`granted_by_user_id` text,
	`demo_request_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`demo_request_id`) REFERENCES `demo_requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_grants_email_unique` ON `access_grants` (`email`);--> statement-breakpoint
CREATE INDEX `idx_access_grant_status` ON `access_grants` (`status`);
