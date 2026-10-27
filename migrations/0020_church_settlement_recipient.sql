-- Church settlements: who received the money (e.g. Mom) and when they passed
-- it on to church. Additive only — existing rows keep NULL and the Funds page
-- asks to assign a recipient. (Hand-written like 0018/0019: drizzle-kit's
-- snapshot lineage stops at 0017 and cannot generate non-interactively.)
ALTER TABLE `church_settlements` ADD COLUMN `recipient_id` text;
--> statement-breakpoint
ALTER TABLE `church_settlements` ADD COLUMN `handed_over_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_church_settlements_recipient` ON `church_settlements` (`family_id`,`recipient_id`);
