ALTER TABLE `event_attendees` ADD `rsvp` text DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE `event_attendees` ADD `rsvp_at` integer;