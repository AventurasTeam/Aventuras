CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text,
	`file_path` text NOT NULL,
	`size_bytes` integer,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`pending_delete_at` integer
);
--> statement-breakpoint
CREATE TABLE `branch_era_flips` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`at_worldtime` integer NOT NULL,
	`era_name` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`theme` text NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`start_entry_id` text NOT NULL,
	`end_entry_id` text NOT NULL,
	`token_count` integer NOT NULL,
	`closed_at` integer NOT NULL,
	`embedding_stale` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `character_relationships` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`a_id` text NOT NULL,
	`b_id` text NOT NULL,
	`kind` text,
	`inverse_kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "char_rel_canonical_order" CHECK("character_relationships"."a_id" < "character_relationships"."b_id"),
	CONSTRAINT "char_rel_one_pov" CHECK("character_relationships"."kind" IS NOT NULL OR "character_relationships"."inverse_kind" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `char_rel_pair_uniq` ON `character_relationships` (`branch_id`,`a_id`,`b_id`);--> statement-breakpoint
CREATE INDEX `char_rel_branch_a_idx` ON `character_relationships` (`branch_id`,`a_id`);--> statement-breakpoint
CREATE INDEX `char_rel_branch_b_idx` ON `character_relationships` (`branch_id`,`b_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`retired_reason` text,
	`injection_mode` text NOT NULL,
	`name_collision_flag` integer DEFAULT 0 NOT NULL,
	`state` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`embedding_stale` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entry_assets` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`role` text,
	`position` integer,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `happening_awareness` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`happening_id` text NOT NULL,
	`character_id` text NOT NULL,
	`learned_at_entry_id` text,
	`decay_resistance` real,
	`retrieval_count` integer DEFAULT 0 NOT NULL,
	`source` text,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `haw_natural_uniq` ON `happening_awareness` (`branch_id`,`character_id`,`happening_id`);--> statement-breakpoint
CREATE TABLE `happening_involvements` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`happening_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `happenings` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`icon` text,
	`temporal` text,
	`occurred_at_entry_id` text,
	`common_knowledge` integer DEFAULT 0 NOT NULL,
	`embedding_stale` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "happenings_mutual_excl" CHECK("happenings"."occurred_at_entry_id" IS NULL OR "happenings"."temporal" IS NULL)
);
--> statement-breakpoint
CREATE TABLE `lore` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`category` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`injection_mode` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`embedding_stale` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `probe_captures` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`target_entry_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	`capture_mode` text NOT NULL,
	`embedding_model_id` text,
	`failure_reason` text,
	`payload` blob,
	`payload_size` integer,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`icon` text,
	`status` text NOT NULL,
	`injection_mode` text NOT NULL,
	`triggered_at_entry_id` text,
	`resolved_at_entry_id` text,
	`embedding_stale` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `translations` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`field` text NOT NULL,
	`language` text NOT NULL,
	`translated_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translations_natural_uniq` ON `translations` (`branch_id`,`target_kind`,`target_id`,`field`,`language`);--> statement-breakpoint
CREATE TABLE `vault_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`definition` text,
	`favorite` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `embedding_model_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `embedding_provider_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_story_settings` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_calendar_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `default_suggestion_categories` text DEFAULT '{"adventure":[],"creative":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `appearance` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `ui_language` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `onboarding_completed_at` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD `classifier_status` text;