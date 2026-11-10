//! Migration 046 rewrites each image profile's ComfyUI custom workflow inside the `image_profiles`
//! blob. The application reads it through the SQL plugin, so the rules are checked here.

use serde_json::{Value, json};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};

/// Runs the migration over a `settings` table holding `image_profiles`, as one script, the way the
/// plugin runs it, and returns the blob afterwards.
async fn migrate(profiles: Value) -> Value {
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('image_profiles', ?)")
        .bind(profiles.to_string())
        .execute(&pool)
        .await
        .unwrap();

    sqlx::raw_sql(include_str!("../migrations/046_comfy_workflow_paths.sql"))
        .execute(&pool)
        .await
        .unwrap();

    let row = sqlx::query("SELECT value FROM settings WHERE key = 'image_profiles'")
        .fetch_one(&pool)
        .await
        .unwrap();
    serde_json::from_str(&row.get::<String, _>("value")).unwrap()
}

fn workflow() -> Value {
    json!({
        "3": { "class_type": "KSampler", "inputs": { "seed": 1 } },
        "4": { "class_type": "KSamplerAdvanced", "inputs": { "noise_seed": 1 } },
        "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "" } },
    })
}

fn profile(custom_workflow: Value) -> Value {
    json!({
        "id": "p1",
        "providerType": "comfy",
        "model": "flux",
        "providerOptions": { "mode": "custom-workflow", "cfg": 1, "customWorkflow": custom_workflow },
        "createdAt": 1,
    })
}

fn stored(over: Value) -> Value {
    let mut custom = json!({
        "workflow": workflow(),
        "positivePromptPath": "6.inputs.text",
        "seedPath": "3.inputs.seed",
        "outputNodeId": "9",
        "negativePromptPath": null,
    });
    for (key, value) in over.as_object().unwrap() {
        custom[key] = value.clone();
    }
    custom
}

async fn custom_of(custom_workflow: Value) -> Value {
    let migrated = migrate(json!([profile(custom_workflow)])).await;
    migrated[0]["providerOptions"]["customWorkflow"].clone()
}

#[tokio::test]
async fn the_single_prompt_path_becomes_a_list_and_the_old_key_goes() {
    let custom = custom_of(stored(json!({}))).await;

    assert_eq!(custom["positivePromptPaths"], json!(["6.inputs.text"]));
    assert_eq!(custom["negativePromptPaths"], json!([]));
    assert_eq!(custom["outputNodeId"], "9");
    assert!(custom.get("positivePromptPath").is_none());
    assert!(custom.get("negativePromptPath").is_none());
}

#[tokio::test]
async fn the_single_negative_path_becomes_a_list() {
    let custom = custom_of(stored(json!({ "negativePromptPath": "7.inputs.text" }))).await;

    assert_eq!(custom["negativePromptPaths"], json!(["7.inputs.text"]));
    assert!(custom.get("negativePromptPath").is_none());
}

#[tokio::test]
async fn a_negative_that_is_also_the_prompt_is_dropped() {
    let custom = custom_of(stored(json!({ "negativePromptPath": "6.inputs.text" }))).await;

    assert_eq!(custom["positivePromptPaths"], json!(["6.inputs.text"]));
    assert_eq!(custom["negativePromptPaths"], json!([]));
}

#[tokio::test]
async fn a_seed_path_that_missed_noise_seed_is_pointed_at_it() {
    let custom = custom_of(stored(json!({ "seedPath": "4.inputs.seed" }))).await;

    assert_eq!(custom["seedPath"], "4.inputs.noise_seed");
}

#[tokio::test]
async fn a_real_seed_path_is_left_alone() {
    let custom = custom_of(stored(json!({ "seedPath": "3.inputs.seed" }))).await;

    assert_eq!(custom["seedPath"], "3.inputs.seed");
}

#[tokio::test]
async fn a_seed_path_off_the_workflow_is_left_alone() {
    for path in ["99.inputs.seed", "4.inputs.inputs.seed", "4.inputs.cfg"] {
        let custom = custom_of(stored(json!({ "seedPath": path }))).await;
        assert_eq!(custom["seedPath"], path, "{path}");
    }
}

#[tokio::test]
async fn a_missing_seed_path_becomes_null() {
    let mut custom = stored(json!({}));
    custom.as_object_mut().unwrap().remove("seedPath");

    assert_eq!(custom_of(custom).await["seedPath"], Value::Null);
}

#[tokio::test]
async fn other_options_and_profiles_without_a_custom_workflow_are_untouched() {
    let plain = json!({
        "id": "p2",
        "providerType": "comfy",
        "model": "flux",
        "providerOptions": { "mode": "basic-txt2img", "cfg": 7 },
        "createdAt": 2,
    });
    let null_workflow = profile(Value::Null);

    let migrated = migrate(json!([
        profile(stored(json!({}))),
        plain.clone(),
        null_workflow.clone()
    ]))
    .await;

    assert_eq!(migrated[0]["providerOptions"]["mode"], "custom-workflow");
    assert_eq!(migrated[0]["providerOptions"]["cfg"], 1);
    assert_eq!(migrated[1], plain);
    assert_eq!(migrated[2], null_workflow);
}

#[tokio::test]
async fn entries_that_are_not_objects_are_dropped_and_a_non_array_is_left_alone() {
    let blob = json!([profile(stored(json!({}))), "oops", null, 3]);

    let migrated = migrate(blob).await;
    assert_eq!(migrated.as_array().unwrap().len(), 1);
    assert_eq!(
        migrated[0]["providerOptions"]["customWorkflow"]["positivePromptPaths"],
        json!(["6.inputs.text"])
    );
    assert_eq!(migrate(json!({})).await, json!({}));
}
