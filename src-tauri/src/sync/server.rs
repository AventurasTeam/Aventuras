use axum::{
    extract::{DefaultBodyLimit, State},
    routing::post,
    Json, Router,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use super::types::{SyncAction, SyncRequest, SyncResponse, SyncStoryPreview};

/// Shared state for the sync server
#[derive(Clone)]
pub struct ServerState {
    /// Authentication token
    pub token: String,
    /// Stories available on this server (JSON strings in Aventura format)
    pub stories: Arc<Mutex<Vec<StoriesData>>>,
    /// Stories received from clients (pushed stories)
    pub received_stories: Arc<Mutex<Vec<String>>>,
}

/// Data about a story available on the server
#[derive(Clone)]
pub struct StoriesData {
    pub preview: SyncStoryPreview,
    pub full_data: String,
}

impl ServerState {
    pub fn new(token: String) -> Self {
        Self {
            token,
            stories: Arc::new(Mutex::new(Vec::new())),
            received_stories: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

/// Bind a listener for the sync HTTP server on a random local port
pub async fn bind_listener() -> Result<TcpListener, String> {
    TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind server: {}", e))
}

/// Build the sync router with shared state
pub fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/sync", post(handle_sync))
        // Increase body limit to 100MB for large stories with embedded images
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .with_state(state)
}

/// Start the sync HTTP server task
pub fn spawn_server(listener: TcpListener, app: Router) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("Sync server error: {}", e);
        }
    })
}

/// Handle sync requests
async fn handle_sync(
    State(state): State<ServerState>,
    Json(request): Json<SyncRequest>,
) -> Json<SyncResponse> {
    // Validate token
    if request.token != state.token {
        return Json(SyncResponse::Error {
            message: "Invalid authentication token".to_string(),
        });
    }

    match request.action {
        SyncAction::ListStories => {
            let stories = state.stories.lock().await;
            let previews: Vec<SyncStoryPreview> =
                stories.iter().map(|s| s.preview.clone()).collect();
            Json(SyncResponse::StoriesList { stories: previews })
        }
        SyncAction::PullStory { story_id } => {
            let stories = state.stories.lock().await;
            if let Some(story) = stories.iter().find(|s| s.preview.id == story_id) {
                Json(SyncResponse::StoryData {
                    data: story.full_data.clone(),
                })
            } else {
                Json(SyncResponse::Error {
                    message: format!("Story not found: {}", story_id),
                })
            }
        }
        SyncAction::PushStory { story_data } => {
            let mut received = state.received_stories.lock().await;
            received.push(story_data);
            Json(SyncResponse::Success {
                message: "Story received successfully".to_string(),
            })
        }
    }
}
