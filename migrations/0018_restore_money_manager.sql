-- Restore Money Manager + Device Lock + Secrets Vault schema onto the feature branch.
-- Idempotent: production already has most of these from the main lineage.
-- CREATE IF NOT EXISTS never drops or rewrites data.
-- Expenses column shape (amount_cents → amount_minor) is handled by
-- scripts/ensure_money_schema.mjs / tests/helpers — never by DROP/recreate here.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`scheme_version` integer DEFAULT 1 NOT NULL,
	`kdf_params` text DEFAULT '{"alg":"PBKDF2-SHA256","iter":600000}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `vaults_family_id_unique` ON `vaults` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_keys` (
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
CREATE INDEX IF NOT EXISTS `idx_vaultkey_vault` ON `vault_keys` (`vault_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vaultkey_member` ON `vault_keys` (`member_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_vaultkey_member_method` ON `vault_keys` (`vault_id`,`member_id`,`wrap_method`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_member_keys` (
	`member_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`wrapped_privkey` text NOT NULL,
	`privkey_iv` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_passkeys` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `vault_passkeys_credential_id_unique` ON `vault_passkeys` (`credential_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_passkey_user` ON `vault_passkeys` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_items` (
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
CREATE INDEX IF NOT EXISTS `idx_vitem_family_status` ON `vault_items` (`family_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vitem_blind_title` ON `vault_items` (`blind_title`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vitem_blind_account` ON `vault_items` (`blind_account`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_blind_tags` (
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag`),
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_vbtag_tag` ON `vault_blind_tags` (`tag`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_item_keys` (
	`item_id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`wrap_iv` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vault_item_versions` (
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
CREATE INDEX IF NOT EXISTS `idx_vitemver_item` ON `vault_item_versions` (`item_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `device_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key_jwk` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `device_credentials_credential_id_unique` ON `device_credentials` (`credential_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_device_cred_user` ON `device_credentials` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `device_pins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text,
	`parent_category_id` text,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_expense_category_family_archived` ON `expense_categories` (`family_id`,`archived`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_expense_category_name` ON `expense_categories` (`family_id`,`parent_category_id`,`name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`label` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_income_family_owner` ON `incomes` (`family_id`,`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_income_active` ON `incomes` (`family_id`,`active`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`amount_kind` text DEFAULT 'fixed' NOT NULL,
	`amount_minor` integer,
	`percent_bp` integer,
	`currency` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer,
	`day_of_week` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`total_installments` integer,
	`category_id` text,
	`auto_log` integer DEFAULT false NOT NULL,
	`remind_days_before` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_commitment_family_owner` ON `commitments` (`family_id`,`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_commitment_status` ON `commitments` (`family_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_commitment_kind` ON `commitments` (`family_id`,`kind`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `financial_settings` (
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`savings_target_kind` text DEFAULT 'none' NOT NULL,
	`savings_target_minor` integer,
	`savings_target_percent_bp` integer,
	`payday_day_of_month` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `family_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `category_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`monthly_limit_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_category_budget` ON `category_budgets` (`user_id`,`category_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`url` text,
	`estimated_cost_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`target_date` text,
	`category_id` text,
	`status` text DEFAULT 'wanted' NOT NULL,
	`purchased_expense_id` text,
	`purchased_at` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wishlist_family_owner` ON `wishlist_items` (`family_id`,`owner_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wishlist_status_priority` ON `wishlist_items` (`family_id`,`status`,`priority`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fund_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_accounts_family_status` ON `fund_accounts` (`family_id`,`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fund_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`payer_name` text NOT NULL,
	`payer_member_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_at` integer NOT NULL,
	`note` text,
	`external_ref` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_member_id`) REFERENCES `family_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_contrib_fund_paid` ON `fund_contributions` (`fund_id`,`paid_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_contrib_family` ON `fund_contributions` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fund_spends` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`spend_date` text NOT NULL,
	`merchant` text,
	`description` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_spends_fund_date` ON `fund_spends` (`fund_id`,`spend_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_spends_family` ON `fund_spends` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fund_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`period_key` text NOT NULL,
	`contributions_minor` integer NOT NULL,
	`spends_minor` integer NOT NULL,
	`remaining_minor` integer NOT NULL,
	`settled_at` integer NOT NULL,
	`settled_by_user_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_fund_settlement_period` ON `fund_settlements` (`fund_id`,`period_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_settlements_family` ON `fund_settlements` (`family_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fund_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`fund_id` text NOT NULL,
	`family_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fund_id`) REFERENCES `fund_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fund_activity_fund_created` ON `fund_activity` (`fund_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `church_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`fund_slug` text NOT NULL,
	`period_key` text NOT NULL,
	`collected_minor` integer NOT NULL,
	`spent_minor` integer NOT NULL,
	`due_minor` integer NOT NULL,
	`paid_minor` integer NOT NULL,
	`remaining_minor` integer NOT NULL,
	`settled_at` integer NOT NULL,
	`settled_by_user_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settled_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_church_settlements_family` ON `church_settlements` (`family_id`,`settled_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_church_settlements_fund` ON `church_settlements` (`family_id`,`fund_slug`,`period_key`);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commitment_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`commitment_id` text NOT NULL,
	`period_key` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`reminded_at` integer,
	`expense_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`commitment_id`) REFERENCES `commitments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_commitment_period` ON `commitment_payments` (`commitment_id`,`period_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_commitment_payment_due` ON `commitment_payments` (`due_date`,`paid`);
