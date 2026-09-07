DROP INDEX `uq_church_settlement_period`;--> statement-breakpoint
ALTER TABLE `church_settlements` ADD `due_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `church_settlements` ADD `paid_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing rows were full-month snapshots (not partial). Treat them as fully paid
-- so they do not inflate the new carry-forward outstanding balance.
UPDATE `church_settlements` SET `due_minor` = `remaining_minor`, `paid_minor` = `remaining_minor`, `remaining_minor` = 0 WHERE `due_minor` = 0 AND `paid_minor` = 0;--> statement-breakpoint
CREATE INDEX `idx_church_settlements_fund` ON `church_settlements` (`family_id`,`fund_slug`,`period_key`);
