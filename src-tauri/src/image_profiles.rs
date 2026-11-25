//! Migration 042 rewrites the `api_profiles`, `image_profiles` and `system_services_settings` blobs
//! in place.
//! The application reads them through the SQL plugin, so the rules are checked here.

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Row, SqlitePool};

    /// Runs the migration over a `settings` table holding `rows`, as one script, the way the
    /// plugin runs it.
    async fn migrate(rows: &[(&str, Value)]) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for (key, value) in rows {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value.to_string())
                .execute(&pool)
                .await
                .unwrap();
        }

        sqlx::raw_sql(include_str!("../migrations/042_image_profiles.sql"))
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    async fn setting(pool: &SqlitePool, key: &str) -> Option<Value> {
        sqlx::query("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
            .map(|row| serde_json::from_str(&row.get::<String, _>("value")).unwrap())
    }

    fn api_profile(id: &str, provider: &str, base_url: Option<&str>) -> Value {
        let mut profile = json!({
            "id": id,
            "name": format!("{id} profile"),
            "providerType": provider,
            "apiKey": "sk-test",
        });
        if let Some(url) = base_url {
            profile["baseUrl"] = json!(url);
        }
        profile
    }

    fn image_profile(provider: &str, base_url: Option<&str>, model: &str) -> Value {
        let mut profile = json!({
            "id": "p1",
            "name": "existing",
            "providerType": provider,
            "apiKey": "",
            "model": model,
            "providerOptions": {},
            "createdAt": 1,
        });
        if let Some(url) = base_url {
            profile["baseUrl"] = json!(url);
        }
        profile
    }

    fn services(image_generation: Value) -> Value {
        json!({ "imageGeneration": image_generation, "tts": { "enabled": true } })
    }

    #[tokio::test]
    async fn legacy_slots_become_one_profile_per_api_profile_and_model() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([
                    api_profile("a1", "nanogpt", None),
                    api_profile("a2", "google", None),
                ]),
            ),
            (
                "system_services_settings",
                services(json!({
                    "profileId": "a1",
                    "model": "flux",
                    "referenceProfileId": "a1",
                    "referenceModel": "flux",
                    "portraitProfileId": "a2",
                    "portraitModel": "imagen",
                    "backgroundProfileId": null,
                    "size": "1024x1024",
                })),
            ),
        ])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        let profiles = profiles.as_array().unwrap();
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0]["name"], "a1 profile (flux)");
        assert_eq!(profiles[0]["providerType"], "nanogpt");
        assert_eq!(profiles[0]["apiKey"], "sk-test");
        assert_eq!(profiles[0]["model"], "flux");
        assert_eq!(profiles[0]["providerOptions"], json!({}));
        assert!(profiles[0].get("baseUrl").is_none());
        assert!(profiles[0]["createdAt"].as_i64().unwrap() > 1_000_000_000_000);
        assert_eq!(profiles[1]["providerType"], "google");

        let first = profiles[0]["id"].as_str().unwrap();
        let second = profiles[1]["id"].as_str().unwrap();
        assert_ne!(first, second);
        assert_eq!(first.len(), 36);
        assert_eq!(&first[14..15], "4");

        let services = setting(&pool, "system_services_settings").await.unwrap();
        let slots = &services["imageGeneration"];
        assert_eq!(slots["profileId"], first);
        assert_eq!(slots["referenceProfileId"], first);
        assert_eq!(slots["portraitProfileId"], second);
        assert!(slots["backgroundProfileId"].is_null());
        assert_eq!(slots["size"], "1024x1024");
        assert_eq!(services["tts"], json!({ "enabled": true }));
        for gone in [
            "model",
            "referenceModel",
            "portraitModel",
            "backgroundModel",
        ] {
            assert!(slots.get(gone).is_none(), "{gone} should be dropped");
        }
    }

    #[tokio::test]
    async fn legacy_profiles_follow_the_provider_rewrites() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([
                    api_profile("proxy", "openai", Some("https://litellm.local/v1")),
                    api_profile("direct", "openai", Some("https://api.openai.com/v1")),
                    api_profile("bare", "openai", None),
                    api_profile("chutes-bare", "chutes", None),
                    api_profile("chutes-set", "chutes", Some("https://llm.chutes.ai/v1")),
                ]),
            ),
            (
                "system_services_settings",
                services(json!({
                    "profileId": "proxy", "model": "m",
                    "referenceProfileId": "direct", "referenceModel": "m",
                    "portraitProfileId": "bare", "portraitModel": "m",
                    "backgroundProfileId": "chutes-bare", "backgroundModel": "m",
                })),
            ),
        ])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        let profiles = profiles.as_array().unwrap();
        let kinds: Vec<_> = profiles
            .iter()
            .map(|p| {
                (
                    p["providerType"].as_str().unwrap(),
                    p["baseUrl"].as_str().unwrap_or(""),
                )
            })
            .collect();
        assert_eq!(
            kinds,
            [
                ("openai-compatible", "https://litellm.local/v1"),
                ("openai", "https://api.openai.com/v1"),
                ("openai", ""),
                ("openai-compatible", "https://api.chutes.ai/v1"),
            ]
        );
    }

    #[tokio::test]
    async fn a_provider_that_draws_no_images_leaves_its_slot_alone() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([api_profile("a1", "anthropic", None)]),
            ),
            (
                "system_services_settings",
                services(json!({
                    "profileId": "a1", "model": "m",
                    "referenceProfileId": "missing", "referenceModel": "m",
                })),
            ),
        ])
        .await;

        assert!(setting(&pool, "image_profiles").await.is_none());
        let services = setting(&pool, "system_services_settings").await.unwrap();
        assert_eq!(services["imageGeneration"]["profileId"], "a1");
        assert_eq!(services["imageGeneration"]["referenceProfileId"], "missing");
    }

    #[tokio::test]
    async fn saved_image_profiles_stop_the_legacy_step_but_not_the_rewrites() {
        let pool = migrate(&[
            (
                "image_profiles",
                json!([
                    image_profile("chutes", None, "z-image-turbo"),
                    image_profile("openai", Some("https://litellm.local/v1"), ""),
                ]),
            ),
            ("api_profiles", json!([api_profile("a1", "nanogpt", None)])),
            (
                "system_services_settings",
                services(json!({ "profileId": "a1", "model": "flux" })),
            ),
        ])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        let profiles = profiles.as_array().unwrap();
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0]["providerType"], "openai-compatible");
        assert_eq!(profiles[0]["baseUrl"], "https://api.chutes.ai/v1");
        assert_eq!(profiles[0]["model"], "z-image-turbo");
        assert_eq!(profiles[1]["providerType"], "openai-compatible");
        assert_eq!(profiles[1]["model"], "flux");

        let services = setting(&pool, "system_services_settings").await.unwrap();
        assert_eq!(services["imageGeneration"]["profileId"], "a1");
    }

    #[tokio::test]
    async fn an_empty_array_still_takes_the_legacy_step() {
        let pool = migrate(&[
            ("image_profiles", json!([])),
            (
                "api_profiles",
                json!([api_profile("a1", "pollinations", None)]),
            ),
            (
                "system_services_settings",
                services(json!({ "profileId": "a1", "model": "flux" })),
            ),
        ])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        assert_eq!(profiles.as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_array_holding_a_non_object_is_left_alone() {
        let pool = migrate(&[(
            "image_profiles",
            json!([image_profile("chutes", None, ""), "stray"]),
        )])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        assert_eq!(profiles[0]["providerType"], "chutes");
        assert_eq!(profiles[0]["model"], "");
    }

    const BIGMODEL: &str = "https://open.bigmodel.cn/api/paas/v4";

    #[tokio::test]
    async fn an_unset_zhipu_base_url_is_pinned_on_api_and_image_profiles() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([
                    api_profile("missing", "zhipu", None),
                    api_profile("empty", "zhipu", Some("")),
                    api_profile("blank", "zhipu", Some("  ")),
                ]),
            ),
            (
                "image_profiles",
                json!([
                    image_profile("zhipu", None, "cogview-4-250304"),
                    image_profile("zhipu", Some(""), "cogview-4-250304"),
                    image_profile("zhipu", Some("  "), "cogview-4-250304"),
                ]),
            ),
        ])
        .await;

        for key in ["api_profiles", "image_profiles"] {
            let profiles = setting(&pool, key).await.unwrap();
            let urls: Vec<_> = profiles
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["baseUrl"].as_str().unwrap())
                .collect();
            assert_eq!(urls, [BIGMODEL; 3], "{key}");
        }
    }

    #[tokio::test]
    async fn a_zhipu_base_url_that_is_set_is_left_alone() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([api_profile(
                    "a1",
                    "zhipu",
                    Some("https://api.z.ai/api/paas/v4")
                )]),
            ),
            (
                "image_profiles",
                json!([image_profile(
                    "zhipu",
                    Some("https://proxy.local/v4"),
                    "glm-image"
                )]),
            ),
        ])
        .await;

        let api = setting(&pool, "api_profiles").await.unwrap();
        assert_eq!(api[0]["baseUrl"], "https://api.z.ai/api/paas/v4");
        let images = setting(&pool, "image_profiles").await.unwrap();
        assert_eq!(images[0]["baseUrl"], "https://proxy.local/v4");
        assert_eq!(images[0]["model"], "glm-image");
    }

    #[tokio::test]
    async fn a_legacy_zhipu_slot_inherits_the_pinned_base_url() {
        let pool = migrate(&[
            ("api_profiles", json!([api_profile("z1", "zhipu", None)])),
            (
                "system_services_settings",
                services(json!({ "profileId": "z1", "model": "cogview-3-flash" })),
            ),
        ])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        assert_eq!(profiles[0]["providerType"], "zhipu");
        assert_eq!(profiles[0]["baseUrl"], BIGMODEL);
        assert_eq!(profiles[0]["model"], "cogview-3-flash");
    }

    #[tokio::test]
    async fn an_empty_zhipu_model_becomes_cogview_and_other_providers_flux() {
        let pool = migrate(&[(
            "image_profiles",
            json!([
                image_profile("zhipu", Some("https://api.z.ai/api/paas/v4"), ""),
                image_profile("nanogpt", None, ""),
                image_profile("pollinations", None, ""),
            ]),
        )])
        .await;

        let profiles = setting(&pool, "image_profiles").await.unwrap();
        let models: Vec<_> = profiles
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["model"].as_str().unwrap())
            .collect();
        assert_eq!(models, ["cogview-4-250304", "flux", "flux"]);
    }

    #[tokio::test]
    async fn other_providers_keep_their_empty_base_url() {
        let pool = migrate(&[
            (
                "api_profiles",
                json!([
                    api_profile("n1", "nanogpt", None),
                    api_profile("o1", "openrouter", Some("")),
                ]),
            ),
            (
                "image_profiles",
                json!([image_profile("nanogpt", None, "flux")]),
            ),
        ])
        .await;

        let api = setting(&pool, "api_profiles").await.unwrap();
        assert!(api[0].get("baseUrl").is_none());
        assert_eq!(api[1]["baseUrl"], "");
        let images = setting(&pool, "image_profiles").await.unwrap();
        assert!(images[0].get("baseUrl").is_none());
    }

    #[tokio::test]
    async fn an_api_profile_array_holding_a_non_object_is_left_alone() {
        let pool = migrate(&[(
            "api_profiles",
            json!([api_profile("z1", "zhipu", None), "stray"]),
        )])
        .await;

        let api = setting(&pool, "api_profiles").await.unwrap();
        assert!(api[0].get("baseUrl").is_none());
    }

    #[tokio::test]
    async fn a_database_with_no_image_settings_is_untouched() {
        let pool = migrate(&[("theme", json!("dark"))]).await;

        assert!(setting(&pool, "image_profiles").await.is_none());
        assert_eq!(setting(&pool, "theme").await.unwrap(), json!("dark"));
    }
}
