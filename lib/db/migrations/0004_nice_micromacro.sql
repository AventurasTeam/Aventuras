CREATE TABLE `wizard_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
