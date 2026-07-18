use base64::{engine::general_purpose::STANDARD, Engine};
use image::Luma;
use qrcode::QrCode;
use std::io::Cursor;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::server::{bind_listener, build_router, spawn_server, ServerState, StoriesData};
use super::types::{
    QrCodeData, SyncAction, SyncRequest, SyncResponse, SyncServerInfo, SyncStoryPreview,
};

/// State managed by Tauri for sync operations
pub struct SyncState {
    /// Handle to the running server task
    server_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// Current server state (for accessing received stories)
    server_state: Arc<Mutex<Option<ServerState>>>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            server_handle: Arc::new(Mutex::new(None)),
            server_state: Arc::new(Mutex::new(None)),
        }
    }
}

/// Generate a QR code as base64-encoded PNG
fn generate_qr_code(data: &str) -> Result<String, String> {
    let code =
        QrCode::new(data.as_bytes()).map_err(|e| format!("Failed to create QR code: {}", e))?;

    let image = code.render::<Luma<u8>>().min_dimensions(256, 256).build();

    let mut buffer = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode QR code: {}", e))?;

    Ok(STANDARD.encode(&buffer))
}

/// Get the local IP address
fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| format!("Failed to get local IP: {}", e))
}

/// Parse story preview from Aventura export JSON
fn parse_story_preview(json: &str) -> Result<SyncStoryPreview, String> {
    let data: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let story = data.get("story").ok_or("Missing 'story' field in export")?;
    let entries = data
        .get("entries")
        .and_then(|e| e.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    Ok(SyncStoryPreview {
        id: story
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        title: story
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string(),
        genre: story
            .get("genre")
            .and_then(|v| v.as_str())
            .map(String::from),
        updated_at: story.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0),
        entry_count: entries,
    })
}

/// Start the sync server with available stories
#[tauri::command]
pub async fn start_sync_server(
    app: AppHandle,
    state: State<'_, SyncState>,
    stories_json: Option<Vec<String>>,
) -> Result<SyncServerInfo, String> {
    // Stop any existing server first
    stop_sync_server(state.clone()).await?;

    // Generate a new token
    let token = Uuid::new_v4().to_string();

    // Create server state
    let server_state = ServerState::new(token.clone());

    // Add stories if provided
    if let Some(stories) = stories_json {
        let mut stories_data = server_state.stories.lock().await;
        for story_json in stories {
            match parse_story_preview(&story_json) {
                Ok(preview) => {
                    stories_data.push(StoriesData {
                        preview,
                        full_data: story_json,
                    });
                }
                Err(e) => {
                    eprintln!("Failed to parse story: {}", e);
                }
            }
        }
    }

    // Bind listener before starting the server task
    let listener = bind_listener().await?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;

    // Get local IP for QR data
    let ip = get_local_ip()?;
    let port = addr.port();

    // Generate QR code with connection data
    let qr_data = QrCodeData {
        ip: ip.clone(),
        port,
        token: token.clone(),
        version: app.package_info().version.to_string(),
    };
    let qr_json = serde_json::to_string(&qr_data)
        .map_err(|e| format!("Failed to serialize QR data: {}", e))?;
    let qr_code_base64 = generate_qr_code(&qr_json)?;

    // Start the server after QR data is ready
    let app = build_router(server_state.clone());
    let handle = spawn_server(listener, app);

    // Store handles
    *state.server_handle.lock().await = Some(handle);
    *state.server_state.lock().await = Some(server_state);

    Ok(SyncServerInfo {
        ip,
        port,
        token,
        qr_code_base64,
    })
}

/// Stop the sync server
#[tauri::command]
pub async fn stop_sync_server(state: State<'_, SyncState>) -> Result<(), String> {
    let mut handle = state.server_handle.lock().await;
    if let Some(h) = handle.take() {
        h.abort();
    }
    *state.server_state.lock().await = None;
    Ok(())
}

/// Get stories that were pushed to this server
#[tauri::command]
pub async fn get_received_stories(state: State<'_, SyncState>) -> Result<Vec<String>, String> {
    let server_state = state.server_state.lock().await;
    if let Some(ref ss) = *server_state {
        let received = ss.received_stories.lock().await;
        Ok(received.clone())
    } else {
        Ok(Vec::new())
    }
}

/// Clear received stories after processing
#[tauri::command]
pub async fn clear_received_stories(state: State<'_, SyncState>) -> Result<(), String> {
    let server_state = state.server_state.lock().await;
    if let Some(ref ss) = *server_state {
        let mut received = ss.received_stories.lock().await;
        received.clear();
    }
    Ok(())
}

/// Connect to a remote sync server and list available stories
#[tauri::command]
pub async fn sync_connect(
    ip: String,
    port: u16,
    token: String,
) -> Result<Vec<SyncStoryPreview>, String> {
    let url = format!("http://{}:{}/sync", ip, port);

    let request = SyncRequest {
        token,
        action: SyncAction::ListStories,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let sync_response: SyncResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    match sync_response {
        SyncResponse::StoriesList { stories } => Ok(stories),
        SyncResponse::Error { message } => Err(message),
        _ => Err("Unexpected response type".to_string()),
    }
}

/// Pull a story from a remote server
#[tauri::command]
pub async fn sync_pull_story(
    ip: String,
    port: u16,
    token: String,
    story_id: String,
) -> Result<String, String> {
    let url = format!("http://{}:{}/sync", ip, port);

    let request = SyncRequest {
        token,
        action: SyncAction::PullStory { story_id },
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let sync_response: SyncResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    match sync_response {
        SyncResponse::StoryData { data } => Ok(data),
        SyncResponse::Error { message } => Err(message),
        _ => Err("Unexpected response type".to_string()),
    }
}

/// Push a story to a remote server
#[tauri::command]
pub async fn sync_push_story(
    ip: String,
    port: u16,
    token: String,
    story_json: String,
) -> Result<(), String> {
    let url = format!("http://{}:{}/sync", ip, port);

    let request = SyncRequest {
        token,
        action: SyncAction::PushStory {
            story_data: story_json,
        },
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let sync_response: SyncResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    match sync_response {
        SyncResponse::Success { .. } => Ok(()),
        SyncResponse::Error { message } => Err(message),
        _ => Err("Unexpected response type".to_string()),
    }
}
