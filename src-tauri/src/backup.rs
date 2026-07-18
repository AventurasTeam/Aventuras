//! Native backup / restore / image-export commands.
//!
//! These move large payloads (the SQLite database, exported images) entirely inside the
//! native side: the bytes are streamed file-to-file (or DB-to-file) and never cross the
//! Tauri IPC bridge nor land in the WebView's JS heap. Only small parameters (paths, ids)
//! travel over IPC. This is the robust fix for the Android OutOfMemoryError crashes that
//! the earlier chunked-IPC TS helpers only mitigated.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose, Engine as _};
use futures_util::TryStreamExt;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Path to the live application database (app_data_dir/aventura.db).
fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("aventura.db"))
}

/// Open the export destination for writing, returning a real `std::fs::File`.
///
/// `dest` is whatever the save dialog returned: a `content://` SAF URI on Android, or a real path
/// on desktop. For the URI we open the app-owned file descriptor via the fs plugin (ContentResolver)
/// in read+write+truncate mode — that fd is seekable, which `ZipWriter` requires — so the export is
/// written STRAIGHT to the user-chosen location. No temp file, no second copy, and (being native)
/// no bytes cross the JS bridge.
fn open_dest(app: &AppHandle, dest: &str) -> Result<File, String> {
    use std::str::FromStr;
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

    // Infallible: yields Url for `content://…`, Path otherwise.
    match FilePath::from_str(dest).unwrap() {
        FilePath::Url(url) => {
            let mut opts = OpenOptions::new();
            opts.read(true).write(true).truncate(true).create(true);
            app.fs()
                .open(FilePath::Url(url), opts)
                .map_err(|e| format!("failed to open destination: {e}"))
        }
        FilePath::Path(p) => {
            File::create(&p).map_err(|e| format!("failed to create {}: {e}", p.display()))
        }
    }
}

/// Create a backup ZIP at `dest_path` containing the (already VACUUMed) database file and a
/// metadata entry. `dest_path` is a real filesystem path — the save-dialog result on desktop,
/// or a file inside the app external dir on Android — so the whole archive is written natively
/// with no bytes crossing the JS/IPC bridge.
///
/// The DB is streamed straight from disk into the archive, so nothing larger than an internal
/// buffer is ever held in memory.
#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    db_path: String,
    dest_path: String,
    metadata_json: String,
) -> Result<String, String> {
    let src = PathBuf::from(&db_path);

    let mut db_file =
        File::open(&src).map_err(|e| format!("failed to open db snapshot {db_path}: {e}"))?;
    let out = open_dest(&app, &dest_path)?;
    let mut zip = ZipWriter::new(out);

    // Level 1 (fastest): the DB is mostly base64-encoded PNGs — already-compressed data expanded
    // 33%. Level 1 cheaply recovers that base64 bloat; higher levels burn far more CPU (brutal on
    // mobile) for almost no extra shrink, since the PNGs themselves don't recompress.
    let deflated = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(1));
    zip.start_file("aventura.db", deflated)
        .map_err(|e| format!("failed to add db to archive: {e}"))?;
    io::copy(&mut db_file, &mut zip)
        .map_err(|e| format!("failed to stream db into archive: {e}"))?;

    zip.start_file("metadata.json", SimpleFileOptions::default())
        .map_err(|e| format!("failed to add metadata to archive: {e}"))?;
    zip.write_all(metadata_json.as_bytes())
        .map_err(|e| format!("failed to write metadata: {e}"))?;

    zip.finish()
        .map_err(|e| format!("failed to finalize archive: {e}"))?;
    Ok(dest_path)
}

/// Restore the database from a backup ZIP.
///
/// Extracts only the `aventura.db` entry (older backups may also contain `stories/*.avt`,
/// which are ignored). The extracted DB is staged in a temp file alongside the target and
/// validated BEFORE the live DB is touched, so a truncated archive, a CRC mismatch or a full
/// disk leaves the existing database completely untouched. The swap itself is two renames
/// within the same directory (atomic, and free in disk space): the live DB becomes the
/// pre-restore safety copy, then the staged DB takes its place.
///
/// The caller is expected to restart the app immediately after, since the sql plugin still
/// holds the old file open.
#[tauri::command]
pub async fn restore_database(app: AppHandle, zip_path: String) -> Result<(), String> {
    let target = db_path(&app)?;
    restore_db_from_zip(&zip_path, &target)
}

/// The restore itself, in terms of plain paths so it can be exercised without an `AppHandle`.
fn restore_db_from_zip(zip_path: &str, target: &Path) -> Result<(), String> {
    let app_dir = target
        .parent()
        .ok_or_else(|| "invalid db path".to_string())?
        .to_path_buf();

    let file =
        File::open(zip_path).map_err(|e| format!("failed to open backup {zip_path}: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("invalid backup archive: {e}"))?;

    // 1. Stage the extracted DB next to the target (same filesystem, so the swap below can be a
    //    rename). Nothing here touches the live DB, so any failure is a clean no-op.
    let staged = with_suffix(target, ".restore-staged");
    let _ = std::fs::remove_file(&staged);
    let staged_result = (|| -> Result<(), String> {
        let mut entry = archive
            .by_name("aventura.db")
            .map_err(|_| "backup does not contain aventura.db".to_string())?;
        let mut out = File::create(&staged)
            .map_err(|e| format!("failed to open staged db for writing: {e}"))?;
        // Reading the entry to completion also verifies the zip CRC, so a corrupted or truncated
        // archive fails here rather than after the live DB is gone.
        io::copy(&mut entry, &mut out)
            .map_err(|e| format!("failed to stream db from archive: {e}"))?;
        out.flush()
            .map_err(|e| format!("failed to flush staged db: {e}"))?;
        Ok(())
    })();
    if let Err(e) = staged_result {
        let _ = std::fs::remove_file(&staged);
        return Err(e);
    }

    // 2. Validate the staged file before it can replace anything.
    if let Err(e) = validate_sqlite_file(&staged) {
        let _ = std::fs::remove_file(&staged);
        return Err(e);
    }

    // 3. Swap. Renaming (rather than copying) the live DB aside costs no extra disk space, which
    //    matters on Android where the DB can be hundreds of MB.
    let safety = app_dir.join("aventura-pre-restore.db");
    let had_target = target.exists();
    if had_target {
        let _ = std::fs::remove_file(&safety);
        std::fs::rename(target, &safety).map_err(|e| {
            let _ = std::fs::remove_file(&staged);
            format!("failed to set aside the current database: {e}")
        })?;
    }

    if let Err(e) = std::fs::rename(&staged, target) {
        // Put the original back so the app is left exactly as it was.
        if had_target {
            let _ = std::fs::rename(&safety, target);
        }
        let _ = std::fs::remove_file(&staged);
        return Err(format!("failed to replace database file: {e}"));
    }

    // Remove WAL/SHM side files that could otherwise conflict with the restored DB.
    for suffix in ["-wal", "-shm"] {
        let side = with_suffix(target, suffix);
        let _ = std::fs::remove_file(side);
    }

    Ok(())
}

/// Sanity-check that a file really is a SQLite database before it replaces the live one.
///
/// The zip CRC already guarantees the bytes survived extraction intact, so this only has to
/// catch a backup whose `aventura.db` entry is empty or isn't a database at all.
fn validate_sqlite_file(path: &Path) -> Result<(), String> {
    use std::io::Read;

    const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

    let mut file =
        File::open(path).map_err(|e| format!("failed to reopen the restored database: {e}"))?;
    let mut header = [0u8; 16];
    file.read_exact(&mut header)
        .map_err(|_| "the backup's database is empty or truncated".to_string())?;
    if header != SQLITE_MAGIC {
        return Err("the backup's database is not a valid SQLite file".to_string());
    }
    Ok(())
}

/// Append `suffix` to a path's file name (e.g. aventura.db -> aventura.db-wal).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// Decode an image's stored value (optionally a `data:` URL) into raw bytes.
fn decode_image(data: &str) -> Result<Vec<u8>, String> {
    let b64 = match data.split_once(',') {
        Some((prefix, rest)) if prefix.starts_with("data:") => rest,
        _ => data,
    };
    general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("invalid base64: {e}"))
}

/// Open a read-only connection pool to the live database.
async fn open_ro_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let db = db_path(app)?;
    let options = SqliteConnectOptions::new().filename(&db).read_only(true);
    SqlitePool::connect_with(options)
        .await
        .map_err(|e| format!("failed to open database: {e}"))
}

/// Export a story's embedded images to a ZIP. A single ordered query streams the rows so only
/// one image is decoded/held at a time, and each decoded PNG is written straight into the
/// archive on disk. Peak memory is one image.
///
/// Returns the number of images written.
#[tauri::command]
pub async fn export_images_zip(
    app: AppHandle,
    story_id: String,
    dest_path: String,
    selected_ids: Option<Vec<String>>,
) -> Result<String, String> {
    let pool = open_ro_pool(&app).await?;
    let selection = selected_ids.map(|v| v.into_iter().collect::<std::collections::HashSet<_>>());

    let out = open_dest(&app, &dest_path)?;
    let mut zip = ZipWriter::new(out);
    // PNGs are already compressed — store without re-deflating.
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    let mut rows = sqlx::query(
        "SELECT id, image_data FROM embedded_images WHERE story_id = ? ORDER BY created_at ASC",
    )
    .bind(&story_id)
    .fetch(&pool);

    let mut written = 0usize;
    while let Some(row) = rows
        .try_next()
        .await
        .map_err(|e| format!("failed to read images: {e}"))?
    {
        let id: String = row.get("id");
        if let Some(sel) = &selection {
            if !sel.contains(&id) {
                continue;
            }
        }
        let data: String = row.get("image_data");
        if data.is_empty() {
            continue;
        }
        let bytes = match decode_image(&data) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[export] skipping image {id}: {e}");
                continue;
            }
        };

        let name = format!("image-{:03}.png", written + 1);
        zip.start_file(&name, stored)
            .map_err(|e| format!("failed to add {name}: {e}"))?;
        zip.write_all(&bytes)
            .map_err(|e| format!("failed to write {name}: {e}"))?;
        written += 1;
    }

    drop(rows);

    if written == 0 {
        // Nothing was written — finalize the (empty) archive and report.
        let _ = zip.finish();
        pool.close().await;
        return Err("No valid images to export".to_string());
    }

    zip.finish()
        .map_err(|e| format!("failed to finalize archive: {e}"))?;
    pool.close().await;
    Ok(dest_path)
}

/// Export a single embedded image as a PNG at `dest_path`, decoding its base64 from SQLite
/// natively. Returns the written path.
#[tauri::command]
pub async fn export_single_image(
    app: AppHandle,
    image_id: String,
    dest_path: String,
) -> Result<String, String> {
    let pool = open_ro_pool(&app).await?;
    let row = sqlx::query("SELECT image_data FROM embedded_images WHERE id = ?")
        .bind(&image_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("failed to read image {image_id}: {e}"))?;
    pool.close().await;

    let data: String = row
        .map(|r| r.get::<String, _>("image_data"))
        .filter(|d| !d.is_empty())
        .ok_or_else(|| "Invalid image data".to_string())?;
    let bytes = decode_image(&data)?;

    let mut out = open_dest(&app, &dest_path)?;
    out.write_all(&bytes)
        .map_err(|e| format!("failed to write image: {e}"))?;
    out.flush()
        .map_err(|e| format!("failed to flush image: {e}"))?;
    Ok(dest_path)
}

/// Write a story's `.avt` export to `dest_path`, natively.
///
/// The frontend passes the full export JSON with `embeddedImages` as METADATA only (no base64),
/// so nothing heavy crosses the IPC bridge. This command fills in each image's base64 `imageData`
/// from SQLite and streams the completed JSON to disk — keeping the image bytes off the WebView
/// JS heap (their sole home would otherwise be a giant `JSON.stringify` string → Android OOM).
/// Returns the written path.
#[tauri::command]
pub async fn export_story_avt(
    app: AppHandle,
    story_json: String,
    dest_path: String,
) -> Result<String, String> {
    let mut root: serde_json::Value =
        serde_json::from_str(&story_json).map_err(|e| format!("invalid export json: {e}"))?;

    // Story id, used to pull all images in one query below.
    let story_id = root
        .get("story")
        .and_then(|s| s.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Map each image id to its slot in the array (metadata only — cheap).
    let mut index_by_id: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    if let Some(images) = root.get("embeddedImages").and_then(|v| v.as_array()) {
        for (i, img) in images.iter().enumerate() {
            if let Some(id) = img.get("id").and_then(|v| v.as_str()) {
                index_by_id.insert(id.to_string(), i);
            }
        }
    }

    let pool = open_ro_pool(&app).await?;
    // One query for the whole story instead of one per image, STREAMED: each row's base64 is moved
    // straight into its JSON slot, so peak memory stays one row + the output (never all rows at
    // once, which would double the heap and risk OOM on large galleries).
    if let Some(sid) = &story_id {
        if !index_by_id.is_empty() {
            let mut rows =
                sqlx::query("SELECT id, image_data FROM embedded_images WHERE story_id = ?")
                    .bind(sid)
                    .fetch(&pool);
            while let Some(row) = rows
                .try_next()
                .await
                .map_err(|e| format!("failed to read images: {e}"))?
            {
                let id: String = row.get("id");
                if let Some(&i) = index_by_id.get(&id) {
                    let data: String = row.get("image_data");
                    if let Some(obj) = root
                        .get_mut("embeddedImages")
                        .and_then(|v| v.get_mut(i))
                        .and_then(|v| v.as_object_mut())
                    {
                        obj.insert("imageData".to_string(), serde_json::Value::String(data));
                    }
                }
            }
        }
    }
    pool.close().await;

    let file = open_dest(&app, &dest_path)?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, &root).map_err(|e| format!("failed to write avt: {e}"))?;
    // Flush the buffer to the fd explicitly before it closes, so nothing is lost on a SAF fd.
    writer
        .flush()
        .map_err(|e| format!("failed to flush avt: {e}"))?;
    Ok(dest_path)
}

/// Copy a user-picked SAF `content://` source (the backup chosen via the open dialog on Android)
/// into a real temp file in the app dir, and return its path. Restore needs a real, seekable file:
/// the picked URI cannot be `std::fs::open`ed, so we stream it in natively via the fs plugin's
/// content-URI file descriptor (no bytes cross the JS bridge).
///
/// These temps are full copies of the user's backup (hundreds of MB), so stale ones are swept
/// here, on the way in. Cleaning up after a restore instead would not work: the app calls
/// `exit(0)` on success, so a post-restore cleanup would never run in the normal case — and it
/// would still leak if the OS killed the app mid-restore.
#[tauri::command]
pub fn import_saf_to_temp(app: AppHandle, src_uri: String) -> Result<String, String> {
    use std::str::FromStr;
    use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

    // Stage into the app's INTERNAL cache dir: always writable via std::fs. (The app-specific
    // external dir /sdcard/Android/data/<id>/files is NOT reliably creatable under scoped storage
    // and gave ENOENT.) This temp is internal-only; the user's backup itself lives wherever they
    // picked it and is read via the SAF fd below.
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache dir: {e}"))?;
    std::fs::create_dir_all(&dir).ok();

    // Sweep temps left behind by earlier restores (see the note above on why cleanup lives here).
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_stale_temp = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(".tmp-restore-") && n.ends_with(".zip"));
            if is_stale_temp && path.is_file() {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest_path = dir.join(format!(".tmp-restore-{millis}.zip"));

    let src_fp = FilePath::from_str(&src_uri).map_err(|e| format!("invalid source uri: {e}"))?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    let mut src = app
        .fs()
        .open(src_fp, opts)
        .map_err(|e| format!("failed to open source: {e}"))?;
    let mut out =
        File::create(&dest_path).map_err(|e| format!("failed to create temp restore file: {e}"))?;
    io::copy(&mut src, &mut out).map_err(|e| format!("failed to copy source: {e}"))?;
    out.flush()
        .map_err(|e| format!("failed to flush temp: {e}"))?;
    Ok(dest_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

    /// Minimal stand-in for a real database file: enough bytes to look like SQLite.
    fn fake_db_bytes(marker: &str) -> Vec<u8> {
        let mut v = SQLITE_HEADER.to_vec();
        v.extend_from_slice(marker.as_bytes());
        v
    }

    /// A stand-in big enough that the zip's entry data dominates the archive, so a byte flipped
    /// in the middle lands in the compressed payload (and trips the CRC on read) rather than in
    /// the local header or central directory (which would fail before extraction even starts).
    fn big_fake_db_bytes(marker: &str) -> Vec<u8> {
        let mut v = fake_db_bytes(marker);
        // Incompressible filler, so the stored entry stays large after deflate.
        let mut seed = 0x5eed_u32;
        v.resize(256 * 1024, 0);
        for byte in v.iter_mut().skip(SQLITE_HEADER.len() + marker.len()) {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            *byte = (seed >> 24) as u8;
        }
        v
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, data) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    fn read(path: &Path) -> Vec<u8> {
        let mut buf = Vec::new();
        File::open(path).unwrap().read_to_end(&mut buf).unwrap();
        buf
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aventura-restore-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn restores_and_keeps_the_previous_db_as_safety_copy() {
        let dir = temp_dir("happy");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        std::fs::write(&target, fake_db_bytes("old")).unwrap();
        write_zip(&zip, &[("aventura.db", &fake_db_bytes("new"))]);

        restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap();

        assert_eq!(read(&target), fake_db_bytes("new"));
        assert_eq!(
            read(&dir.join("aventura-pre-restore.db")),
            fake_db_bytes("old")
        );
        assert!(!target.with_extension("db.restore-staged").exists());
    }

    /// The regression this whole staging dance exists for: extraction that dies PART WAY THROUGH,
    /// which is exactly when the old code had already truncated the live DB via File::create.
    #[test]
    fn leaves_the_live_db_untouched_when_the_archive_is_corrupt() {
        let dir = temp_dir("corrupt");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        let precious = big_fake_db_bytes("precious");
        std::fs::write(&target, &precious).unwrap();
        write_zip(&zip, &[("aventura.db", &big_fake_db_bytes("new"))]);

        // Flip a byte inside the entry's compressed data so the CRC fails only once the reader has
        // streamed through it — i.e. after the point of no return in the old implementation.
        let mut bytes = read(&zip);
        let len = bytes.len();
        bytes[len / 2] ^= 0xFF;
        std::fs::write(&zip, &bytes).unwrap();

        let err = restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap_err();

        // The whole point: a failed restore must not cost the user their database.
        assert_eq!(read(&target), precious, "live DB was damaged: {err}");
        assert!(
            !dir.join("aventura.db.restore-staged").exists(),
            "staged temp leaked"
        );
    }

    /// A truncated archive (download cut short, SAF copy interrupted) must be equally harmless.
    #[test]
    fn leaves_the_live_db_untouched_when_the_archive_is_truncated() {
        let dir = temp_dir("truncated");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        let precious = big_fake_db_bytes("precious");
        std::fs::write(&target, &precious).unwrap();
        write_zip(&zip, &[("aventura.db", &big_fake_db_bytes("new"))]);

        let bytes = read(&zip);
        std::fs::write(&zip, &bytes[..bytes.len() / 2]).unwrap();

        let err = restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap_err();
        assert_eq!(read(&target), precious, "live DB was damaged: {err}");
    }

    #[test]
    fn leaves_the_live_db_untouched_when_the_entry_is_not_a_database() {
        let dir = temp_dir("notadb");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        std::fs::write(&target, fake_db_bytes("precious")).unwrap();
        write_zip(&zip, &[("aventura.db", b"this is not a database")]);

        let err = restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap_err();

        assert!(
            err.contains("not a valid SQLite file"),
            "unexpected error: {err}"
        );
        assert_eq!(read(&target), fake_db_bytes("precious"));
    }

    #[test]
    fn leaves_the_live_db_untouched_when_the_archive_has_no_db_entry() {
        let dir = temp_dir("noentry");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        std::fs::write(&target, fake_db_bytes("precious")).unwrap();
        write_zip(&zip, &[("metadata.json", b"{}")]);

        let err = restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap_err();

        assert!(
            err.contains("does not contain aventura.db"),
            "unexpected error: {err}"
        );
        assert_eq!(read(&target), fake_db_bytes("precious"));
        assert!(!dir.join("aventura.db.restore-staged").exists());
    }

    #[test]
    fn removes_stale_wal_and_shm_side_files() {
        let dir = temp_dir("wal");
        let target = dir.join("aventura.db");
        let zip = dir.join("backup.zip");
        std::fs::write(&target, fake_db_bytes("old")).unwrap();
        std::fs::write(dir.join("aventura.db-wal"), b"stale wal").unwrap();
        std::fs::write(dir.join("aventura.db-shm"), b"stale shm").unwrap();
        write_zip(&zip, &[("aventura.db", &fake_db_bytes("new"))]);

        restore_db_from_zip(zip.to_str().unwrap(), &target).unwrap();

        assert!(!dir.join("aventura.db-wal").exists());
        assert!(!dir.join("aventura.db-shm").exists());
    }
}
