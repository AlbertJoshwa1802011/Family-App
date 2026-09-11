-- Idempotent: add events.client_request_id for create-retry dedupe.
-- Safe on production that already has Money Manager restore (0018).
ALTER TABLE `events` ADD COLUMN `client_request_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_client_request` ON `events` (`family_id`,`created_by`,`client_request_id`);
