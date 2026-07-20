CREATE VIRTUAL TABLE IF NOT EXISTS entities_vec_384 USING vec0(
	id text primary key,
	branch_id text partition key,
	model_id text,
	+source_hash text,
	embedding float[384]
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS lore_vec_384 USING vec0(
	id text primary key,
	branch_id text partition key,
	model_id text,
	+source_hash text,
	embedding float[384]
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS happenings_vec_384 USING vec0(
	id text primary key,
	branch_id text partition key,
	model_id text,
	+source_hash text,
	embedding float[384]
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS threads_vec_384 USING vec0(
	id text primary key,
	branch_id text partition key,
	model_id text,
	+source_hash text,
	embedding float[384]
);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS chapter_summaries_vec_384 USING vec0(
	id text primary key,
	branch_id text partition key,
	model_id text,
	+source_hash text,
	embedding float[384]
);
