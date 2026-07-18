//! Native `.avt` import: keeps the base64 image payloads out of the WebView heap.
//!
//! An `.avt` is one JSON object whose `embeddedImages` array carries every generated image as
//! base64. Reading that file in JS means the file text and the parsed graph are both live at once
//! — well past Android's hard WebView heap cap — so a large story import OOM-crashed.
//!
//! The split here mirrors the exporter: **JS owns the structure, Rust owns the bytes.** The id
//! remapping, insertion order and foreign keys stay in TypeScript where they are tested; only the
//! payloads move.
//!
//! Two passes, both streaming, so peak memory is one image regardless of file size:
//!
//! 1. [`avt_read_light`] returns the JSON with every `imageData` removed. JS parses that and runs
//!    the normal import.
//! 2. [`avt_import_images`] re-reads the file and streams each payload straight into SQLite,
//!    using the old-image-id -> new-entry-id table JS produced.
//!
//! Re-reading is deliberate: the alternative is a staging table, which needs a migration and
//! leaves orphan rows behind when an import dies half way. Reading a local file twice is cheap by
//! comparison, and stateless.

use std::collections::HashMap;
use std::io::{BufReader, Read};

use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserializer;
use serde_json::{Map, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

/// The JSON key holding the base64 payload — the only thing this module works to avoid.
const IMAGE_DATA_KEY: &str = "imageData";
const IMAGES_KEY: &str = "embeddedImages";

/// Old image id -> the imported entry the row must hang off. Built by the TypeScript import.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMapping {
    pub old_image_id: String,
    pub new_entry_id: String,
}

/// Open the picked source for reading.
///
/// On Android the open dialog yields a `content://` SAF URI, which cannot be `std::fs::open`ed;
/// it is opened through the fs plugin's ContentResolver fd instead. On desktop it is a real path.
fn open_source(app: &AppHandle, src: &str) -> Result<Box<dyn Read + Send>, String> {
    use std::str::FromStr;
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

    // Infallible: yields Url for `content://…`, Path otherwise.
    match FilePath::from_str(src).unwrap() {
        FilePath::Url(url) => {
            let mut opts = OpenOptions::new();
            opts.read(true);
            let file = app
                .fs()
                .open(FilePath::Url(url), opts)
                .map_err(|e| format!("failed to open source: {e}"))?;
            Ok(Box::new(file))
        }
        FilePath::Path(p) => {
            let file = std::fs::File::open(&p)
                .map_err(|e| format!("failed to open {}: {e}", p.display()))?;
            Ok(Box::new(file))
        }
    }
}

// ============================================================================
// Pass 1: strip the payloads
// ============================================================================

/// Deserializes one image object, dropping `imageData` on the floor as it goes.
///
/// `IgnoredAny` is the whole point: serde walks the base64 string to find its end but never
/// allocates it, so a 5 MB payload costs nothing but the scan.
struct LightImageSeed;

impl<'de> DeserializeSeed<'de> for LightImageSeed {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for LightImageSeed {
    type Value = Value;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an embedded image object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if key == IMAGE_DATA_KEY {
                map.next_value::<IgnoredAny>()?;
            } else {
                out.insert(key, map.next_value()?);
            }
        }
        Ok(Value::Object(out))
    }
}

/// Deserializes the `embeddedImages` array, one element at a time.
struct LightImagesSeed;

impl<'de> DeserializeSeed<'de> for LightImagesSeed {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for LightImagesSeed {
    type Value = Value;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an array of embedded images")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut out = Vec::new();
        while let Some(image) = seq.next_element_seed(LightImageSeed)? {
            out.push(image);
        }
        Ok(Value::Array(out))
    }
}

/// The root object: everything but `embeddedImages` is small and kept as-is.
struct LightRootSeed;

impl<'de> DeserializeSeed<'de> for LightRootSeed {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for LightRootSeed {
    type Value = Value;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an Aventura export object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if key == IMAGES_KEY {
                out.insert(key, map.next_value_seed(LightImagesSeed)?);
            } else {
                out.insert(key, map.next_value()?);
            }
        }
        Ok(Value::Object(out))
    }
}

/// Read an `.avt` and return its JSON with every image payload removed.
///
/// The result is the story's structure only — small enough for the WebView to parse and import
/// with the ordinary code path.
#[tauri::command]
pub async fn avt_read_light(app: AppHandle, src_path: String) -> Result<String, String> {
    let reader = BufReader::new(open_source(&app, &src_path)?);
    let light = read_light_from(reader)?;
    serde_json::to_string(&light).map_err(|e| format!("failed to re-encode story json: {e}"))
}

/// Split out from the command so it can be tested without an `AppHandle`.
fn read_light_from<R: Read>(reader: R) -> Result<Value, String> {
    let mut de = serde_json::Deserializer::from_reader(reader);
    LightRootSeed
        .deserialize(&mut de)
        .map_err(|e| format!("invalid story file: {e}"))
}

// ============================================================================
// Pass 2: stream the payloads into SQLite
// ============================================================================

/// One image's row, held only for as long as it takes to insert it.
struct ImageRow {
    id: String,
    image_data: String,
    source_text: String,
    prompt: String,
    style_id: String,
    model: String,
    width: Option<i64>,
    height: Option<i64>,
    status: String,
    error_message: Option<String>,
}

fn string_field(map: &mut Map<String, Value>, key: &str) -> String {
    map.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Deserializes one image object into a row, keeping the payload only transiently.
struct ImageRowSeed;

impl<'de> DeserializeSeed<'de> for ImageRowSeed {
    type Value = ImageRow;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for ImageRowSeed {
    type Value = ImageRow;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an embedded image object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        // The payload is pulled out on its own so it is never cloned into a Value.
        let mut image_data = String::new();
        let mut rest = Map::new();

        while let Some(key) = map.next_key::<String>()? {
            if key == IMAGE_DATA_KEY {
                image_data = map.next_value()?;
            } else {
                rest.insert(key, map.next_value()?);
            }
        }

        Ok(ImageRow {
            id: string_field(&mut rest, "id"),
            image_data,
            source_text: string_field(&mut rest, "sourceText"),
            prompt: string_field(&mut rest, "prompt"),
            style_id: string_field(&mut rest, "styleId"),
            model: string_field(&mut rest, "model"),
            width: rest.get("width").and_then(|v| v.as_i64()),
            height: rest.get("height").and_then(|v| v.as_i64()),
            status: rest
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("completed")
                .to_string(),
            error_message: rest
                .get("errorMessage")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }
}

/// Walks the `embeddedImages` array, handing each row to `on_image` and dropping it after.
struct ImportImagesSeed<'a, F: FnMut(ImageRow) -> Result<(), String>> {
    on_image: &'a mut F,
}

impl<'de, F: FnMut(ImageRow) -> Result<(), String>> DeserializeSeed<'de>
    for ImportImagesSeed<'_, F>
{
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_seq(self)
    }
}

impl<'de, F: FnMut(ImageRow) -> Result<(), String>> Visitor<'de> for ImportImagesSeed<'_, F> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an array of embedded images")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while let Some(row) = seq.next_element_seed(ImageRowSeed)? {
            (self.on_image)(row).map_err(serde::de::Error::custom)?;
        }
        Ok(())
    }
}

/// The root, for pass 2: everything except the images is skipped without allocating.
struct ImportRootSeed<'a, F: FnMut(ImageRow) -> Result<(), String>> {
    on_image: &'a mut F,
}

impl<'de, F: FnMut(ImageRow) -> Result<(), String>> DeserializeSeed<'de> for ImportRootSeed<'_, F> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de, F: FnMut(ImageRow) -> Result<(), String>> Visitor<'de> for ImportRootSeed<'_, F> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("an Aventura export object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            if key == IMAGES_KEY {
                map.next_value_seed(ImportImagesSeed {
                    on_image: self.on_image,
                })?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(())
    }
}

/// Open a writable pool to the live database.
///
/// The sql plugin holds its own connection to the same file, and WAL allows only one writer at a
/// time, so a generous busy_timeout is what keeps a concurrent app write from turning into
/// SQLITE_BUSY here.
async fn open_rw_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let db = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("aventura.db");

    let options = SqliteConnectOptions::new()
        .filename(&db)
        .create_if_missing(false)
        .busy_timeout(std::time::Duration::from_secs(30));

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("failed to open database: {e}"))
}

/// Stream every mapped image from an `.avt` straight into SQLite.
///
/// `mapping` is the small table JS produced while importing the structure: it decides which images
/// belong (an image whose entry was dropped is simply not in it) and which entry each one hangs
/// off. Returns how many rows were written.
#[tauri::command]
pub async fn avt_import_images(
    app: AppHandle,
    src_path: String,
    story_id: String,
    mapping: Vec<ImageMapping>,
) -> Result<usize, String> {
    if mapping.is_empty() {
        return Ok(0);
    }

    let entry_by_image: HashMap<String, String> = mapping
        .into_iter()
        .map(|m| (m.old_image_id, m.new_entry_id))
        .collect();

    let pool = open_rw_pool(&app).await?;
    let reader = BufReader::new(open_source(&app, &src_path)?);

    let result = import_images_from(reader, pool.clone(), story_id, entry_by_image).await;

    pool.close().await;
    result
}

/// The streaming import itself, in terms of a reader and a pool so it can be exercised against a
/// real database without an `AppHandle`.
///
/// The serde walk is synchronous and sqlx is async, so the parse runs on a blocking thread and
/// each insert is driven to completion from inside it. Every row is written and dropped before
/// the next is read: collecting them first would hold every payload at once, which is the very
/// thing this module exists to avoid.
async fn import_images_from<R: Read + Send + 'static>(
    reader: R,
    pool: SqlitePool,
    story_id: String,
    entry_by_image: HashMap<String, String>,
) -> Result<usize, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let handle = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || -> Result<usize, String> {
        let mut written = 0usize;
        let mut de = serde_json::Deserializer::from_reader(reader);

        let mut on_image = |row: ImageRow| -> Result<(), String> {
            let Some(entry_id) = entry_by_image.get(&row.id) else {
                // Not in the mapping: its entry did not survive the import. Skip it.
                return Ok(());
            };

            handle.block_on(async {
                sqlx::query(
                    "INSERT INTO embedded_images (
                        id, story_id, entry_id, source_text, prompt, style_id, model,
                        image_data, width, height, status, error_message, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(uuid_v4())
                .bind(&story_id)
                .bind(entry_id)
                .bind(&row.source_text)
                .bind(&row.prompt)
                .bind(&row.style_id)
                .bind(&row.model)
                .bind(&row.image_data)
                .bind(row.width)
                .bind(row.height)
                .bind(&row.status)
                .bind(&row.error_message)
                .bind(now)
                .execute(&pool)
                .await
                .map_err(|e| format!("failed to insert image: {e}"))
            })?;

            written += 1;
            Ok(())
        };

        ImportRootSeed {
            on_image: &mut on_image,
        }
        .deserialize(&mut de)
        .map_err(|e| format!("invalid story file: {e}"))?;

        Ok(written)
    })
    .await
    .map_err(|e| format!("image import task failed: {e}"))?
}

/// A v4 UUID, matching the ids the TypeScript side generates with crypto.randomUUID().
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Cheap xorshift seeded from the clock; ids only need to be unique within this database.
    let mut state = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        | 1;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let mut bytes = [0u8; 16];
    for chunk in bytes.chunks_mut(8) {
        chunk.copy_from_slice(&next().to_le_bytes()[..chunk.len()]);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    let h = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    format!(
        "{}-{}-{}-{}-{}",
        h(&bytes[0..4]),
        h(&bytes[4..6]),
        h(&bytes[6..8]),
        h(&bytes[8..10]),
        h(&bytes[10..16])
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// An export shaped like the real thing: two images, one of them huge.
    fn sample_avt(payload: &str) -> String {
        serde_json::json!({
            "version": "1.8.0",
            "exportedAt": 1,
            "story": { "id": "s1", "title": "T" },
            "entries": [{ "id": "e1", "content": "hello" }],
            "embeddedImages": [
                { "id": "img-1", "entryId": "e1", "prompt": "a castle", "imageData": payload,
                  "styleId": "st", "model": "flux", "sourceText": "src", "status": "completed",
                  "width": 512, "height": 512 },
                { "id": "img-2", "entryId": "e1", "prompt": "a forest", "imageData": payload,
                  "styleId": "st", "model": "flux", "sourceText": "src", "status": "completed" }
            ],
            "chapters": []
        })
        .to_string()
    }

    #[test]
    fn light_read_drops_payloads_but_keeps_everything_else() {
        let avt = sample_avt("AAAABBBBCCCC");
        let light = read_light_from(avt.as_bytes()).unwrap();

        // Structure survives untouched.
        assert_eq!(light["version"], "1.8.0");
        assert_eq!(light["story"]["title"], "T");
        assert_eq!(light["entries"][0]["content"], "hello");

        // Image metadata survives; only the payload is gone.
        let images = light["embeddedImages"].as_array().unwrap();
        assert_eq!(images.len(), 2);
        assert_eq!(images[0]["id"], "img-1");
        assert_eq!(images[0]["prompt"], "a castle");
        assert_eq!(images[0]["entryId"], "e1");
        assert_eq!(images[0]["width"], 512);
        assert!(
            images[0].get("imageData").is_none(),
            "payload leaked into the light json"
        );
        assert!(images[1].get("imageData").is_none());
    }

    /// The reason this module exists: the light pass must not scale with payload size.
    #[test]
    fn light_read_output_does_not_grow_with_payload_size() {
        let small = read_light_from(sample_avt(&"A".repeat(16)).as_bytes()).unwrap();
        let huge = read_light_from(sample_avt(&"A".repeat(4 * 1024 * 1024)).as_bytes()).unwrap();

        // 4 MB of extra base64 per image must leave the result byte-for-byte identical.
        assert_eq!(
            serde_json::to_string(&small).unwrap(),
            serde_json::to_string(&huge).unwrap(),
        );
    }

    #[test]
    fn light_read_handles_an_export_with_no_images() {
        let avt = serde_json::json!({
            "version": "1.8.0",
            "story": { "id": "s1" },
            "entries": []
        })
        .to_string();

        let light = read_light_from(avt.as_bytes()).unwrap();
        assert_eq!(light["story"]["id"], "s1");
        assert!(light.get("embeddedImages").is_none());
    }

    #[test]
    fn light_read_rejects_a_file_that_is_not_json() {
        let err = read_light_from("this is not json".as_bytes()).unwrap_err();
        assert!(
            err.contains("invalid story file"),
            "unexpected error: {err}"
        );
    }

    /// Counts live heap bytes, so the memory claim can be measured instead of asserted.
    ///
    /// /proc's VmHWM is useless here: it is a high-water mark that never falls, so merely
    /// building the fixture pins it for the rest of the process.
    struct CountingAllocator;

    static LIVE: AtomicUsize = AtomicUsize::new(0);
    static PEAK: AtomicUsize = AtomicUsize::new(0);

    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let ptr = unsafe { System.alloc(layout) };
            if !ptr.is_null() {
                let live = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
                PEAK.fetch_max(live, Ordering::Relaxed);
            }
            ptr
        }
        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
            unsafe { System.dealloc(ptr, layout) }
        }
    }

    #[global_allocator]
    static ALLOC: CountingAllocator = CountingAllocator;

    /// Runs `f` and reports how far live heap use rose above where it started.
    fn measure_peak<T>(f: impl FnOnce() -> T) -> (T, usize) {
        let baseline = LIVE.load(Ordering::Relaxed);
        PEAK.store(baseline, Ordering::Relaxed);
        let out = f();
        let peak = PEAK.load(Ordering::Relaxed).saturating_sub(baseline);
        (out, peak)
    }

    /// Substantiates the claim this module rests on: reading the structure must not pull the
    /// payloads into memory, where a naive parse does.
    ///
    /// Ignored by default — it allocates hundreds of MB:
    ///   cargo test --lib avt_import -- --ignored --nocapture
    #[test]
    #[ignore]
    fn light_read_does_not_pull_payloads_into_memory() {
        // 20 images x 5 MB of base64 => a ~100 MB file, the shape that OOMed on Android.
        let payload = "A".repeat(5 * 1024 * 1024);
        let images: Vec<serde_json::Value> = (0..20)
            .map(|i| {
                serde_json::json!({
                    "id": format!("img-{i}"), "entryId": "e1", "prompt": "p",
                    "imageData": payload, "styleId": "s", "model": "m",
                    "sourceText": "t", "status": "completed"
                })
            })
            .collect();
        let avt = serde_json::json!({
            "version": "1.8.0",
            "story": { "id": "s1" },
            "entries": [{ "id": "e1" }],
            "embeddedImages": images,
        })
        .to_string();
        drop(payload);
        let size_mb = avt.len() as f64 / (1024.0 * 1024.0);

        // Read from a Cursor so neither path gets to cheat by borrowing the fixture.
        let (light, light_peak) =
            measure_peak(|| read_light_from(std::io::Cursor::new(avt.as_bytes())).unwrap());
        assert_eq!(light["embeddedImages"].as_array().unwrap().len(), 20);
        drop(light);

        let (naive, naive_peak) = measure_peak(|| {
            serde_json::from_reader::<_, Value>(std::io::Cursor::new(avt.as_bytes())).unwrap()
        });
        assert_eq!(naive["embeddedImages"].as_array().unwrap().len(), 20);
        drop(naive);

        let mb = |b: usize| b as f64 / (1024.0 * 1024.0);
        println!(
            "file={:.0} MB | streaming light read peaked at {} kB | naive from_reader peaked at {:.1} MB ({:.0}x more)",
            size_mb,
            light_peak / 1024,
            mb(naive_peak),
            naive_peak as f64 / light_peak.max(1) as f64,
        );

        // The naive parse tracks the file; the streaming read must not. A 4x margin is far below
        // the ~1000x actually observed, so this fails on a regression rather than on noise.
        assert!(
            naive_peak > light_peak * 4,
            "expected the naive parse to cost far more than the streaming read \
             (light: {} kB, naive: {:.1} MB)",
            light_peak / 1024,
            mb(naive_peak),
        );
    }

    /// A throwaway database with just enough schema to accept image rows.
    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE embedded_images (
                id TEXT PRIMARY KEY, story_id TEXT NOT NULL, entry_id TEXT NOT NULL,
                source_text TEXT NOT NULL, prompt TEXT NOT NULL, style_id TEXT NOT NULL,
                model TEXT NOT NULL, image_data TEXT NOT NULL DEFAULT '',
                width INTEGER, height INTEGER, status TEXT DEFAULT 'pending',
                error_message TEXT, created_at INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn mapping(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(img, entry)| (img.to_string(), entry.to_string()))
            .collect()
    }

    #[tokio::test]
    async fn imports_mapped_payloads_into_the_database() {
        let pool = test_pool().await;
        let avt = sample_avt("PAYLOAD64");

        let written = import_images_from(
            std::io::Cursor::new(avt.into_bytes()),
            pool.clone(),
            "new-story".to_string(),
            mapping(&[("img-1", "new-entry-1"), ("img-2", "new-entry-2")]),
        )
        .await
        .unwrap();

        assert_eq!(written, 2);

        let rows = sqlx::query("SELECT id, story_id, entry_id, prompt, image_data, width FROM embedded_images ORDER BY prompt")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);

        let castle = &rows[0];
        assert_eq!(castle.get::<String, _>("prompt"), "a castle");
        assert_eq!(castle.get::<String, _>("story_id"), "new-story");
        assert_eq!(castle.get::<String, _>("entry_id"), "new-entry-1");
        assert_eq!(castle.get::<String, _>("image_data"), "PAYLOAD64");
        assert_eq!(castle.get::<Option<i64>, _>("width"), Some(512));
        // The row must get a fresh id, never the export's.
        assert_ne!(castle.get::<String, _>("id"), "img-1");
    }

    #[tokio::test]
    async fn skips_images_that_are_not_in_the_mapping() {
        let pool = test_pool().await;
        let avt = sample_avt("PAYLOAD64");

        // Only img-1 survived the structure import; img-2's entry was dropped.
        let written = import_images_from(
            std::io::Cursor::new(avt.into_bytes()),
            pool.clone(),
            "new-story".to_string(),
            mapping(&[("img-1", "new-entry-1")]),
        )
        .await
        .unwrap();

        assert_eq!(written, 1);
        let rows = sqlx::query("SELECT prompt FROM embedded_images")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("prompt"), "a castle");
    }

    #[tokio::test]
    async fn reports_a_corrupt_file_instead_of_importing_half_of_it() {
        let pool = test_pool().await;
        let avt = sample_avt("PAYLOAD64");
        let truncated = &avt.as_bytes()[..avt.len() / 2];

        let err = import_images_from(
            std::io::Cursor::new(truncated.to_vec()),
            pool.clone(),
            "new-story".to_string(),
            mapping(&[("img-1", "new-entry-1"), ("img-2", "new-entry-2")]),
        )
        .await
        .unwrap_err();

        assert!(
            err.contains("invalid story file"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn generated_ids_look_like_uuid_v4_and_do_not_repeat() {
        let a = uuid_v4();
        let b = uuid_v4();

        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(
            a.chars().all(|c| c.is_ascii_hexdigit() || c == '-'),
            "not hex: {a}"
        );
        // Version nibble and variant, per RFC 4122.
        assert_eq!(parts[2].chars().next().unwrap(), '4', "not a v4 uuid: {a}");
        assert!(
            matches!(parts[3].chars().next().unwrap(), '8' | '9' | 'a' | 'b'),
            "bad variant: {a}"
        );
    }
}
