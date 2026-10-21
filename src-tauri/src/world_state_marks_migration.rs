//! Migration 041's marks: existing snapshots, checkpoints and chapters placed among the records.

#[cfg(test)]
mod tests {
    use crate::test_db::{memory_pool, run_migrations};
    use sqlx::{Row, SqlitePool};

    async fn exec(pool: &SqlitePool, sql: &'static str) {
        sqlx::raw_sql(sql).execute(pool).await.unwrap();
    }

    async fn upgraded() -> SqlitePool {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 40).await;
        exec(
            &pool,
            "INSERT INTO stories (id, title, created_at, updated_at) VALUES
               ('s1', 'Story', 0, 0), ('s2', 'Other', 0, 0), ('s3', 'Synced', 0, 0);
             INSERT INTO story_entries (id, story_id, type, content, position, created_at) VALUES
               ('e1', 's1', 'narration', '', 0, 100),
               ('e2', 's1', 'narration', '', 1, 200),
               ('x1', 's2', 'narration', '', 0, 100);
             -- Old deltas on entries a sync re-created after the checkpoint below was made.
             INSERT INTO story_entries
               (id, story_id, type, content, position, created_at, world_state_delta) VALUES
               ('f1', 's3', 'narration', '', 0, 1000, '{}'),
               ('f2', 's3', 'narration', '', 1, 1001, '{}'),
               ('f3', 's3', 'narration', '', 2, 1002, '{}');
             INSERT INTO branches (id, story_id, name, fork_entry_id, created_at)
               VALUES ('b1', 's1', 'Branch', 'e2', 0);
             INSERT INTO story_entries (id, story_id, type, content, position, created_at, branch_id)
               VALUES ('e3', 's1', 'narration', '', 2, 300, 'b1');
             INSERT INTO world_state_changes
               (id, story_id, branch_id, entry_id, seq, kind, origin, continuous, created_at) VALUES
               ('legacy', 's1', NULL, 'e1', -1, 'header', 'legacy', 1, 100),
               ('r1', 's1', NULL, 'e1', 1, 'header', NULL, 1, 150),
               ('r2', 's1', NULL, 'e2', 2, 'header', NULL, 1, 250),
               ('lore', 's1', NULL, 'e2', 3, 'change', 'chapter', NULL, 400),
               ('other', 's2', NULL, 'x1', 5, 'header', NULL, 1, 100);
             INSERT INTO world_state_snapshots
               (id, story_id, branch_id, entry_id, entry_position, characters_snapshot,
                locations_snapshot, items_snapshot, story_beats_snapshot, created_at)
               VALUES ('snap', 's1', NULL, 'e2', 1, '[]', '[]', '[]', '[]', 260);
             INSERT INTO checkpoints
               (id, story_id, name, last_entry_id, entry_count, entries_snapshot,
                characters_snapshot, locations_snapshot, items_snapshot, story_beats_snapshot,
                chapters_snapshot, created_at) VALUES
               ('cp', 's1', 'Checkpoint', 'e3', 3, '[]', '[]', '[]', '[]', '[]', '[]', 270),
               ('orphan', 's1', 'Checkpoint', 'gone', 3, '[]', '[]', '[]', '[]', '[]', '[]', 280),
               ('synced', 's3', 'Checkpoint', 'f2', 2, '[]', '[]', '[]', '[]', '[]', '[]', 10);
             INSERT INTO chapters
               (id, story_id, number, start_entry_id, end_entry_id, entry_count, summary,
                created_at) VALUES
               ('early', 's1', 1, 'e1', 'e1', 1, '', 50),
               ('ch', 's1', 2, 'e2', 'e2', 1, '', 350);",
        )
        .await;
        run_migrations(&pool, 40, 41).await;
        pool
    }

    async fn order(pool: &SqlitePool, story: &str) -> Vec<(i64, String)> {
        sqlx::query(
            "SELECT seq, CASE WHEN kind = 'mark' THEN entity_type || ':' || entity_id ELSE id END
               AS what
             FROM world_state_changes WHERE story_id = ? ORDER BY seq",
        )
        .bind(story)
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|row| (row.get("seq"), row.get("what")))
        .collect()
    }

    #[tokio::test]
    async fn places_each_mark_after_what_was_written_before_it_and_renumbers() {
        let pool = upgraded().await;
        let expected = [
            "legacy",
            "chapter:early",
            "r1",
            "r2",
            "snapshot:snap",
            "checkpoint:cp",
            "chapter:ch",
            "lore",
        ];
        let got: Vec<(i64, String)> = expected
            .iter()
            .enumerate()
            .map(|(i, what)| (i as i64 + 1, what.to_string()))
            .collect();
        assert_eq!(order(&pool, "s1").await, got);
        assert_eq!(order(&pool, "s2").await, vec![(1, "other".to_string())]);
    }

    #[tokio::test]
    async fn places_a_mark_among_converted_history_by_its_entry_not_its_time() {
        let pool = upgraded().await;
        let names: Vec<String> = order(&pool, "s3")
            .await
            .into_iter()
            .map(|(_, w)| w)
            .collect();
        assert_eq!(
            names,
            ["f1:header", "f2:header", "checkpoint:synced", "f3:header"]
        );
    }

    #[tokio::test]
    async fn gives_a_checkpoint_its_entry_branch_and_skips_one_without_an_entry() {
        let pool = upgraded().await;
        let rows = sqlx::query(
            "SELECT entity_id, branch_id, entry_id FROM world_state_changes
             WHERE story_id = 's1' AND kind = 'mark' AND entity_type = 'checkpoint'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("entity_id"), "cp");
        assert_eq!(
            rows[0].get::<Option<String>, _>("branch_id").as_deref(),
            Some("b1")
        );
        assert_eq!(rows[0].get::<String, _>("entry_id"), "e3");
    }

    #[tokio::test]
    async fn deleting_what_a_mark_marks_takes_the_mark() {
        let pool = upgraded().await;
        exec(
            &pool,
            "DELETE FROM world_state_snapshots WHERE id = 'snap';
             DELETE FROM checkpoints WHERE id = 'cp';
             DELETE FROM chapters WHERE id = 'ch';",
        )
        .await;
        let left: Vec<String> = sqlx::query(
            "SELECT entity_id FROM world_state_changes WHERE story_id = 's1' AND kind = 'mark'
             ORDER BY seq",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get("entity_id"))
        .collect();
        assert_eq!(left, ["early"]);
    }
}
