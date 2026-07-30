CREATE INDEX `chapters_stale_idx` ON `chapters` (`branch_id`) WHERE "chapters"."embedding_stale" = 1;--> statement-breakpoint
CREATE INDEX `entities_stale_idx` ON `entities` (`branch_id`) WHERE "entities"."embedding_stale" = 1;--> statement-breakpoint
CREATE INDEX `happenings_stale_idx` ON `happenings` (`branch_id`) WHERE "happenings"."embedding_stale" = 1;--> statement-breakpoint
CREATE INDEX `lore_stale_idx` ON `lore` (`branch_id`) WHERE "lore"."embedding_stale" = 1;--> statement-breakpoint
CREATE INDEX `threads_stale_idx` ON `threads` (`branch_id`) WHERE "threads"."embedding_stale" = 1;