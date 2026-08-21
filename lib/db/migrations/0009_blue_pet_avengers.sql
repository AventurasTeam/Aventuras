PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chapters` (
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
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_chapters`("id", "branch_id", "sequence_number", "title", "summary", "theme", "keywords", "start_entry_id", "end_entry_id", "token_count", "closed_at", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "sequence_number", "title", "summary", "theme", "keywords", "start_entry_id", "end_entry_id", "token_count", "closed_at", "embedding_stale", "created_at", "updated_at" FROM `chapters`;--> statement-breakpoint
DROP TABLE `chapters`;--> statement-breakpoint
ALTER TABLE `__new_chapters` RENAME TO `chapters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chapters_stale_idx` ON `chapters` (`branch_id`) WHERE "chapters"."embedding_stale" = 1;--> statement-breakpoint
CREATE TABLE `__new_entities` (
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
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_entities`("id", "branch_id", "kind", "name", "description", "status", "retired_reason", "injection_mode", "name_collision_flag", "state", "tags", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "kind", "name", "description", "status", "retired_reason", "injection_mode", "name_collision_flag", "state", "tags", "embedding_stale", "created_at", "updated_at" FROM `entities`;--> statement-breakpoint
DROP TABLE `entities`;--> statement-breakpoint
ALTER TABLE `__new_entities` RENAME TO `entities`;--> statement-breakpoint
CREATE INDEX `entities_stale_idx` ON `entities` (`branch_id`) WHERE "entities"."embedding_stale" = 1;--> statement-breakpoint
CREATE TABLE `__new_happenings` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text,
	`icon` text,
	`temporal` text,
	`occurred_at_entry_id` text,
	`common_knowledge` integer DEFAULT 0 NOT NULL,
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "happenings_mutual_excl" CHECK("__new_happenings"."occurred_at_entry_id" IS NULL OR "__new_happenings"."temporal" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_happenings`("id", "branch_id", "title", "description", "category", "icon", "temporal", "occurred_at_entry_id", "common_knowledge", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "title", "description", "category", "icon", "temporal", "occurred_at_entry_id", "common_knowledge", "embedding_stale", "created_at", "updated_at" FROM `happenings`;--> statement-breakpoint
DROP TABLE `happenings`;--> statement-breakpoint
ALTER TABLE `__new_happenings` RENAME TO `happenings`;--> statement-breakpoint
CREATE INDEX `happenings_stale_idx` ON `happenings` (`branch_id`) WHERE "happenings"."embedding_stale" = 1;--> statement-breakpoint
CREATE INDEX `happenings_occurred_idx` ON `happenings` (`branch_id`,`occurred_at_entry_id`);--> statement-breakpoint
CREATE TABLE `__new_lore` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`category` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`injection_mode` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_lore`("id", "branch_id", "title", "body", "category", "tags", "keywords", "injection_mode", "priority", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "title", "body", "category", "tags", "keywords", "injection_mode", "priority", "embedding_stale", "created_at", "updated_at" FROM `lore`;--> statement-breakpoint
DROP TABLE `lore`;--> statement-breakpoint
ALTER TABLE `__new_lore` RENAME TO `lore`;--> statement-breakpoint
CREATE INDEX `lore_stale_idx` ON `lore` (`branch_id`) WHERE "lore"."embedding_stale" = 1;--> statement-breakpoint
CREATE TABLE `__new_threads` (
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
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "branch_id", "title", "description", "category", "icon", "status", "injection_mode", "triggered_at_entry_id", "resolved_at_entry_id", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "title", "description", "category", "icon", "status", "injection_mode", "triggered_at_entry_id", "resolved_at_entry_id", "embedding_stale", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
CREATE INDEX `threads_stale_idx` ON `threads` (`branch_id`) WHERE "threads"."embedding_stale" = 1;