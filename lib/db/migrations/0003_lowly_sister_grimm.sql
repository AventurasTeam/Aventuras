PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_branch_era_flips` (
	`id` text NOT NULL,
	`branch_id` text NOT NULL,
	`at_worldtime` integer NOT NULL,
	`era_name` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "era_flips_worldtime_nonneg" CHECK("__new_branch_era_flips"."at_worldtime" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_branch_era_flips`("id", "branch_id", "at_worldtime", "era_name", "created_at") SELECT "id", "branch_id", "at_worldtime", "era_name", "created_at" FROM `branch_era_flips`;--> statement-breakpoint
DROP TABLE `branch_era_flips`;--> statement-breakpoint
ALTER TABLE `__new_branch_era_flips` RENAME TO `branch_era_flips`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `era_flips_branch_worldtime_uniq` ON `branch_era_flips` (`branch_id`,`at_worldtime`);