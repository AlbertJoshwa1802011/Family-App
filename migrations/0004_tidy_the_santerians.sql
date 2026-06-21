CREATE TABLE `item_reminders_log` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`window_days` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_item_reminder` ON `item_reminders_log` (`item_id`,`user_id`,`window_days`,`channel`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`type` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`subject_member_id` text,
	`title` text NOT NULL,
	`due_date` text,
	`amount_cents` integer,
	`data` text,
	`visibility` text DEFAULT 'family' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`trashed_at` integer,
	`search_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_item_family_type_status` ON `items` (`family_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_item_family_due` ON `items` (`family_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_item_search` ON `items` (`family_id`,`search_text`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_key` text NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`stats` text,
	`error` text,
	FOREIGN KEY (`triggered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_jobrun_key_time` ON `job_runs` (`job_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `platform_admins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` text DEFAULT 'maintainer' NOT NULL,
	`granted_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `storage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`captured_at` integer DEFAULT (unixepoch()) NOT NULL,
	`scope` text NOT NULL,
	`family_id` text,
	`metric` text NOT NULL,
	`value` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_snap_metric_time` ON `storage_snapshots` (`metric`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_snap_family_time` ON `storage_snapshots` (`family_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `vault_blind_tags` (
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag`),
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vbtag_tag` ON `vault_blind_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `vault_item_keys` (
	`item_id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`wrap_iv` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vault_item_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`cipher` text NOT NULL,
	`iv` text NOT NULL,
	`edited_by_member_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_vitemver_item` ON `vault_item_versions` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `vault_items` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`family_id` text NOT NULL,
	`owner_member_id` text,
	`type` text DEFAULT 'other' NOT NULL,
	`visibility` text DEFAULT 'family' NOT NULL,
	`escrow_excluded` integer DEFAULT false NOT NULL,
	`voice_readable` integer DEFAULT false NOT NULL,
	`cipher` text NOT NULL,
	`iv` text NOT NULL,
	`secret_cipher` text,
	`secret_iv` text,
	`blind_title` text,
	`blind_account` text,
	`blind_issuer` text,
	`status` text DEFAULT 'active' NOT NULL,
	`trashed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_vitem_family_status` ON `vault_items` (`family_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_vitem_blind_title` ON `vault_items` (`blind_title`);--> statement-breakpoint
CREATE INDEX `idx_vitem_blind_account` ON `vault_items` (`blind_account`);--> statement-breakpoint
CREATE TABLE `vault_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`member_id` text,
	`is_escrow` integer DEFAULT false NOT NULL,
	`wrap_method` text NOT NULL,
	`wrapped_dek` text NOT NULL,
	`wrap_iv` text,
	`kdf_salt` text,
	`kdf_params` text,
	`grant_ephemeral_pubkey` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vaultkey_vault` ON `vault_keys` (`vault_id`);--> statement-breakpoint
CREATE INDEX `idx_vaultkey_member` ON `vault_keys` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vaultkey_member_method` ON `vault_keys` (`vault_id`,`member_id`,`wrap_method`);--> statement-breakpoint
CREATE TABLE `vault_member_keys` (
	`member_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`wrapped_privkey` text NOT NULL,
	`privkey_iv` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vault_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`label` text,
	`prf_salt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_passkeys_credential_id_unique` ON `vault_passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `idx_passkey_user` ON `vault_passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`scheme_version` integer DEFAULT 1 NOT NULL,
	`kdf_params` text DEFAULT '{"alg":"PBKDF2-SHA256","iter":600000}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaults_family_id_unique` ON `vaults` (`family_id`);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `severity` text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `visibility` text DEFAULT 'family' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_audit_family_time` ON `audit_log` (`family_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor_time` ON `audit_log` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_family_sev_time` ON `audit_log` (`family_id`,`severity`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `prefers_simple_mode` integer DEFAULT false NOT NULL;