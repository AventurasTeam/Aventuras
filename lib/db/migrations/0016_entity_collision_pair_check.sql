PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`name_collision_partner_id` text,
	`name_collision_reason` text,
	`state` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`embedding_stale` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entities_name_collision_pair" CHECK(("__new_entities"."name_collision_flag" = 0 AND "__new_entities"."name_collision_partner_id" IS NULL AND "__new_entities"."name_collision_reason" IS NULL) OR ("__new_entities"."name_collision_flag" = 1 AND "__new_entities"."name_collision_partner_id" IS NOT NULL AND "__new_entities"."name_collision_reason" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_entities`("id", "branch_id", "kind", "name", "description", "status", "retired_reason", "injection_mode", "name_collision_flag", "name_collision_partner_id", "name_collision_reason", "state", "tags", "keywords", "priority", "embedding_stale", "created_at", "updated_at") SELECT "id", "branch_id", "kind", "name", "description", "status", "retired_reason", "injection_mode", "name_collision_flag", "name_collision_partner_id", "name_collision_reason", "state", "tags", "keywords", "priority", "embedding_stale", "created_at", "updated_at" FROM `entities`;--> statement-breakpoint
DROP TABLE `entities`;--> statement-breakpoint
ALTER TABLE `__new_entities` RENAME TO `entities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entities_stale_idx` ON `entities` (`branch_id`) WHERE "entities"."embedding_stale" = 1;