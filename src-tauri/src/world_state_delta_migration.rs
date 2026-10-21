//! Migration 041 against the golden fixture `fromWorldStateDelta` is tested on too
//! (`src/lib/services/stateTracking/legacy-deltas.fixture.json`), so the SQL and the TypeScript
//! conversion of an old delta cannot drift apart.

#[cfg(test)]
mod tests {
    use crate::test_db::{memory_pool, run_migrations};
    use serde_json::Value;
    use sqlx::{Row, SqlitePool};

    const FIXTURE: &str =
        include_str!("../../src/lib/services/stateTracking/legacy-deltas.fixture.json");

    fn text(value: &Value) -> Option<String> {
        match value {
            Value::Null => None,
            Value::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
        }
    }

    /// A database at migration 040 holding the fixture's entries, existing records and
    /// checkpoints, then upgraded through 041.
    async fn upgraded(fixture: &Value) -> SqlitePool {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 40).await;

        for story in ["s1", "s2"] {
            sqlx::query(
                "INSERT INTO stories (id, title, created_at, updated_at) VALUES (?, 'Story', 0, 0)",
            )
            .bind(story)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO branches (id, story_id, name, fork_entry_id, created_at)
             VALUES ('b1', 's1', 'Branch', 'e2', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        for entry in fixture["entries"].as_array().unwrap() {
            // A string is stored as written, so the invalid delta stays invalid.
            sqlx::query(
                "INSERT INTO story_entries
                   (id, story_id, type, content, position, created_at, branch_id, world_state_delta)
                 VALUES (?, ?, 'narration', '', ?, ?, ?, ?)",
            )
            .bind(entry["id"].as_str())
            .bind(entry["storyId"].as_str())
            .bind(entry["position"].as_i64())
            .bind(entry["createdAt"].as_i64())
            .bind(entry["branchId"].as_str())
            .bind(text(&entry["worldStateDelta"]))
            .execute(&pool)
            .await
            .unwrap();
        }
        for row in fixture["existing"].as_array().unwrap() {
            sqlx::query(
                "INSERT INTO world_state_changes
                   (id, story_id, branch_id, entry_id, seq, kind, origin, entity_type, entity_id,
                    op, before, after, continuous, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(row["id"].as_str())
            .bind(row["story_id"].as_str())
            .bind(row["branch_id"].as_str())
            .bind(row["entry_id"].as_str())
            .bind(row["seq"].as_i64())
            .bind(row["kind"].as_str())
            .bind(row["origin"].as_str())
            .bind(row["entity_type"].as_str())
            .bind(row["entity_id"].as_str())
            .bind(row["op"].as_str())
            .bind(text(&row["before"]))
            .bind(text(&row["after"]))
            .bind(row["continuous"].as_i64())
            .bind(row["created_at"].as_i64())
            .execute(&pool)
            .await
            .unwrap();
        }
        for checkpoint in fixture["checkpoints"].as_array().unwrap() {
            sqlx::query(
                "INSERT INTO checkpoints
                   (id, story_id, name, last_entry_id, entry_count, entries_snapshot,
                    characters_snapshot, locations_snapshot, items_snapshot,
                    story_beats_snapshot, chapters_snapshot, created_at)
                 VALUES (?, ?, 'Checkpoint', 'e1', 1, ?, '[]', '[]', '[]', '[]', '[]', 0)",
            )
            .bind(checkpoint["id"].as_str())
            .bind(checkpoint["storyId"].as_str())
            .bind(checkpoint["entriesSnapshot"].to_string())
            .execute(&pool)
            .await
            .unwrap();
        }

        run_migrations(&pool, 40, 41).await;
        pool
    }

    /// Every record row, marks aside, in a story's write order, `before` and `after` parsed.
    async fn records(pool: &SqlitePool) -> Vec<(i64, Value)> {
        let parse =
            |s: Option<String>| s.map_or(Value::Null, |s| serde_json::from_str(&s).unwrap());
        sqlx::query("SELECT * FROM world_state_changes WHERE kind <> 'mark' ORDER BY story_id, seq")
            .fetch_all(pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| {
                let seq: i64 = row.get("seq");
                let value = serde_json::json!({
                    "id": row.get::<String, _>("id"),
                    "story_id": row.get::<String, _>("story_id"),
                    "branch_id": row.get::<Option<String>, _>("branch_id"),
                    "entry_id": row.get::<String, _>("entry_id"),
                    "kind": row.get::<String, _>("kind"),
                    "origin": row.get::<Option<String>, _>("origin"),
                    "entity_type": row.get::<Option<String>, _>("entity_type"),
                    "entity_id": row.get::<Option<String>, _>("entity_id"),
                    "op": row.get::<Option<String>, _>("op"),
                    "before": parse(row.get("before")),
                    "after": parse(row.get("after")),
                    "continuous": row.get::<Option<i64>, _>("continuous"),
                    "created_at": row.get::<i64, _>("created_at"),
                });
                (seq, value)
            })
            .collect()
    }

    #[tokio::test]
    async fn converts_every_delta_as_the_typescript_adapter_does() {
        let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
        let pool = upgraded(&fixture).await;
        let rows = records(&pool).await;

        let existing: Vec<&str> = fixture["existing"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        let converted: Vec<&Value> = rows
            .iter()
            .filter(|(_, r)| !existing.contains(&r["id"].as_str().unwrap()))
            .map(|(_, r)| r)
            .collect();
        let expected: Vec<&Value> = fixture["converted"].as_array().unwrap().iter().collect();
        assert_eq!(converted, expected);

        // Converted rows sort below the rows written before, which keep their order.
        for story in ["s1", "s2"] {
            let order: Vec<bool> = rows
                .iter()
                .filter(|(_, r)| r["story_id"] == story)
                .map(|(_, r)| existing.contains(&r["id"].as_str().unwrap()))
                .collect();
            let first_existing = order.iter().position(|&e| e).unwrap_or(order.len());
            assert!(
                order[first_existing..].iter().all(|&e| e),
                "{story}: {order:?}"
            );
        }
        assert_eq!(
            rows.iter().filter(|(_, r)| r["entry_id"] == "e9").count(),
            2
        );
    }

    #[tokio::test]
    async fn strips_deltas_from_checkpoint_copies_and_drops_the_column() {
        let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
        let pool = upgraded(&fixture).await;

        for checkpoint in fixture["checkpoints"].as_array().unwrap() {
            let stored: String =
                sqlx::query("SELECT entries_snapshot FROM checkpoints WHERE id = ?")
                    .bind(checkpoint["id"].as_str())
                    .fetch_one(&pool)
                    .await
                    .unwrap()
                    .get("entries_snapshot");
            let stored: Value = serde_json::from_str(&stored).unwrap();
            assert_eq!(stored, checkpoint["expected"], "{}", checkpoint["id"]);
        }

        let columns: Vec<String> =
            sqlx::query("SELECT name FROM pragma_table_info('story_entries')")
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.get("name"))
                .collect();
        assert!(!columns.iter().any(|c| c == "world_state_delta"));
    }
}
