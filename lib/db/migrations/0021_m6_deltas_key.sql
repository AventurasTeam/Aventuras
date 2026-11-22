PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deltas` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`entry_id` text,
	`action_id` text NOT NULL,
	`log_position` integer NOT NULL,
	`source` text NOT NULL,
	`target_table` text NOT NULL,
	`target_id` text NOT NULL,
	`op` text NOT NULL,
	`undo_payload` text,
	`encoding_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_deltas`("id", "branch_id", "entry_id", "action_id", "log_position", "source", "target_table", "target_id", "op", "undo_payload", "encoding_version", "created_at") SELECT "id", "branch_id", "entry_id", "action_id", "log_position", "source", "target_table", "target_id", "op", "undo_payload", "encoding_version", "created_at" FROM `deltas`;--> statement-breakpoint
DROP TABLE `deltas`;--> statement-breakpoint
ALTER TABLE `__new_deltas` RENAME TO `deltas`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deltas_chain_idx` ON `deltas` (`branch_id`,`target_id`,`log_position`);--> statement-breakpoint
CREATE UNIQUE INDEX `deltas_log_position_uniq` ON `deltas` (`branch_id`,`log_position`);--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `branch_id` text REFERENCES branches(id);