use base64::{Engine, engine::general_purpose::STANDARD};
use image::Luma;
use qrcode::QrCode;
use std::io::Cursor;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::server::{ServerState, WEBVIEW_TIMEOUT, bind_listener, build_router, spawn_server};
use super::types::{
    PROTOCOL_VERSION, QrCodeData, ReceivedItem, SyncAction, SyncPeer, SyncRequest, SyncResponse,
    SyncServerInfo,
};

/// State managed by Tauri for sync operations
pub struct SyncState {
    /// Handle to the running server task
    server_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// Current server state (for accessing received items)
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

/// Start the sync server
#[tauri::command]
pub async fn start_sync_server(
    app: AppHandle,
    state: State<'_, SyncState>,
) -> Result<SyncServerInfo, String> {
    // Stop any existing server first
    stop_sync_server(state.clone()).await?;

    // Generate a new token
    let token = Uuid::new_v4().to_string();

    // Create server state
    let emitter = app.clone();
    let server_state = ServerState::new(token.clone(), move |request| {
        emitter
            .emit("sync://request", request)
            .map_err(|e| format!("Failed to reach the app: {}", e))
    });

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
        protocol: PROTOCOL_VERSION,
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

/// The webview's answer to a `sync://request`
#[tauri::command]
pub async fn sync_respond(
    state: State<'_, SyncState>,
    request_id: String,
    data: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    if let Some(ref ss) = *state.server_state.lock().await {
        let result = match error {
            Some(message) => Err(message),
            None => Ok(data.unwrap_or_default()),
        };
        ss.answer(&request_id, result).await;
    }
    Ok(())
}

/// Get items that were pushed to this server
#[tauri::command]
pub async fn get_received_items(state: State<'_, SyncState>) -> Result<Vec<ReceivedItem>, String> {
    let server_state = state.server_state.lock().await;
    if let Some(ref ss) = *server_state {
        let received = ss.received.lock().await;
        Ok(received.clone())
    } else {
        Ok(Vec::new())
    }
}

/// Clear received items after processing
#[tauri::command]
pub async fn clear_received_items(state: State<'_, SyncState>) -> Result<(), String> {
    let server_state = state.server_state.lock().await;
    if let Some(ref ss) = *server_state {
        ss.received.lock().await.clear();
    }
    Ok(())
}

/// Send one request to a remote sync server. Answers with the remote webview's reply.
#[tauri::command]
pub async fn sync_request(
    ip: String,
    port: u16,
    token: String,
    peer: SyncPeer,
    action: SyncAction,
) -> Result<String, String> {
    let url = format!("http://{}:{}/sync", ip, port);

    let request = SyncRequest {
        token,
        protocol: PROTOCOL_VERSION,
        peer,
        action,
    };

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Connection failed: {}", e))?;
    let response = client
        .post(&url)
        .json(&request)
        // Past the server's wait, so its own timeout is the one reported.
        .timeout(WEBVIEW_TIMEOUT + std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let sync_response: SyncResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    match sync_response {
        SyncResponse::Reply { data } => Ok(data),
        SyncResponse::Error { message } => Err(message),
    }
}
