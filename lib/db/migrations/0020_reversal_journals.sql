CREATE TABLE `reversal_journals` (
	`action_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`journal` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `action_id`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `rerun_chapter_id` text;