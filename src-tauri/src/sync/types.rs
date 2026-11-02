use serde::{Deserialize, Serialize};

/// Bumped whenever two builds can no longer talk. Peers on different versions refuse to sync.
pub const PROTOCOL_VERSION: u32 = 2;

/// Information about the sync server, returned when starting a server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncServerInfo {
    pub ip: String,
    pub port: u16,
    pub token: String,
    pub qr_code_base64: String,
}

/// The device behind a request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPeer {
    pub device_id: String,
    pub name: String,
}

/// Request sent to the sync server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRequest {
    pub token: String,
    pub protocol: u32,
    pub peer: SyncPeer,
    pub action: SyncAction,
}

/// Actions that can be performed on the sync server.
///
/// Sections and payloads are opaque here: the webview answers them all.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SyncAction {
    /// List a section's items
    List { section: String },
    /// Fetch one item
    Pull { section: String, local_id: String },
    /// Hand over one item, held until the receiver applies or declines it
    Push { payload: String },
    /// Adopt a resolved vector, for content both devices already hold
    SettleVector {
        section: String,
        sync_id: String,
        expected: serde_json::Value,
        vector: serde_json::Value,
    },
}

/// Response from the sync server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncResponse {
    /// The webview's answer, as JSON text
    Reply { data: String },
    /// Operation failed
    Error { message: String },
}

/// A request forwarded to the webview, emitted as `sync://request`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewRequest {
    pub request_id: String,
    pub peer: SyncPeer,
    pub action: SyncAction,
}

/// An item pushed to this device, waiting for the webview
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedItem {
    pub request_id: String,
    pub peer: SyncPeer,
    pub payload: String,
}

/// Data encoded in the QR code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeData {
    pub ip: String,
    pub port: u16,
    pub token: String,
    pub version: String, // App version for compatibility check
    pub protocol: u32,
}
