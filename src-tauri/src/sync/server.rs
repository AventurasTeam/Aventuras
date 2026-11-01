use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    routing::post,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

use super::types::{
    PROTOCOL_VERSION, ReceivedItem, SyncAction, SyncPeer, SyncRequest, SyncResponse, WebviewRequest,
};

/// How long a request waits on the webview. Clients must allow longer.
pub const WEBVIEW_TIMEOUT: Duration = Duration::from_secs(60);

const UPDATE_NEEDED: &str = "This device is on a different sync version. Update both devices.";

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>>;

/// Shared state for the sync server
#[derive(Clone)]
pub struct ServerState {
    /// Authentication token
    pub token: String,
    /// Items pushed by clients, waiting for the webview
    pub received: Arc<Mutex<Vec<ReceivedItem>>>,
    /// Requests the webview has yet to answer
    pending: Pending,
    /// Delivers a request to the webview
    emit: Arc<dyn Fn(WebviewRequest) -> Result<(), String> + Send + Sync>,
    timeout: Duration,
}

impl ServerState {
    pub fn new(
        token: String,
        emit: impl Fn(WebviewRequest) -> Result<(), String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            token,
            received: Arc::new(Mutex::new(Vec::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            emit: Arc::new(emit),
            timeout: WEBVIEW_TIMEOUT,
        }
    }

    /// Ask the webview, waiting up to the timeout.
    async fn ask_webview(&self, peer: SyncPeer, action: SyncAction) -> Result<String, String> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(request_id.clone(), tx);

        let sent = (self.emit)(WebviewRequest {
            request_id: request_id.clone(),
            peer,
            action,
        });
        if let Err(e) = sent {
            self.pending.lock().await.remove(&request_id);
            return Err(e);
        }

        let answer = tokio::time::timeout(self.timeout, rx).await;
        self.pending.lock().await.remove(&request_id);
        match answer {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("The other device dropped the request".to_string()),
            Err(_) => Err("The other device did not answer in time".to_string()),
        }
    }

    /// Hand the webview's answer to the waiting request. A late answer has no one to reach.
    pub async fn answer(&self, request_id: &str, result: Result<String, String>) {
        if let Some(tx) = self.pending.lock().await.remove(request_id) {
            let _ = tx.send(result);
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

/// Handle sync requests.
///
/// The body is taken as loose JSON so a peer on another protocol gets a readable error rather
/// than a rejected request.
async fn handle_sync(
    State(state): State<ServerState>,
    Json(body): Json<serde_json::Value>,
) -> Json<SyncResponse> {
    Json(respond(&state, body).await)
}

async fn respond(state: &ServerState, body: serde_json::Value) -> SyncResponse {
    if body.get("token").and_then(|t| t.as_str()) != Some(state.token.as_str()) {
        return SyncResponse::Error {
            message: "Invalid authentication token".to_string(),
        };
    }

    let Ok(request) = serde_json::from_value::<SyncRequest>(body) else {
        return SyncResponse::Error {
            message: UPDATE_NEEDED.to_string(),
        };
    };
    if request.protocol != PROTOCOL_VERSION {
        return SyncResponse::Error {
            message: UPDATE_NEEDED.to_string(),
        };
    }

    match request.action {
        SyncAction::Push { payload } => {
            state.received.lock().await.push(ReceivedItem {
                peer: request.peer,
                payload,
            });
            SyncResponse::Success {
                message: "Item received successfully".to_string(),
            }
        }
        action => match state.ask_webview(request.peer, action).await {
            Ok(data) => SyncResponse::Reply { data },
            Err(message) => SyncResponse::Error { message },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex as StdMutex;

    fn request(action: serde_json::Value) -> serde_json::Value {
        json!({
            "token": "t",
            "protocol": PROTOCOL_VERSION,
            "peer": { "deviceId": "d", "name": "Phone" },
            "action": action,
        })
    }

    fn list() -> serde_json::Value {
        request(json!({ "type": "list", "section": "stories" }))
    }

    /// A server whose webview never answers, and the requests it was sent.
    fn silent_server() -> (ServerState, Arc<StdMutex<Vec<WebviewRequest>>>) {
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let log = seen.clone();
        let state = ServerState::new("t".to_string(), move |r| {
            log.lock().unwrap().push(r);
            Ok(())
        });
        (state, seen)
    }

    fn message(response: SyncResponse) -> String {
        match response {
            SyncResponse::Error { message } => message,
            other => panic!("expected an error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn the_webview_answer_reaches_the_client() {
        let (state, seen) = silent_server();
        let asking = state.clone();
        let request = tokio::spawn(async move { respond(&asking, list()).await });

        let id = loop {
            if let Some(r) = seen.lock().unwrap().first() {
                break r.request_id.clone();
            }
            tokio::task::yield_now().await;
        };
        state.answer(&id, Ok("[]".to_string())).await;

        match request.await.unwrap() {
            SyncResponse::Reply { data } => assert_eq!(data, "[]"),
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_unanswered_request_times_out_and_leaves_nothing_behind() {
        let (mut state, _) = silent_server();
        state.timeout = Duration::from_millis(10);
        assert!(message(respond(&state, list()).await).contains("did not answer"));
        assert!(state.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn a_late_answer_is_ignored() {
        let (state, _) = silent_server();
        state.answer("gone", Ok(String::new())).await;
    }

    #[tokio::test]
    async fn a_failed_emit_is_reported() {
        let state = ServerState::new("t".to_string(), |_| Err("no webview".to_string()));
        assert_eq!(message(respond(&state, list()).await), "no webview");
        assert!(state.pending.lock().await.is_empty());
    }

    #[tokio::test]
    async fn the_previous_protocol_is_told_to_update() {
        let (state, seen) = silent_server();
        let old = json!({ "token": "t", "action": { "type": "listStories" } });
        assert_eq!(message(respond(&state, old).await), UPDATE_NEEDED);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_different_protocol_number_is_told_to_update() {
        let (state, _) = silent_server();
        let mut body = list();
        body["protocol"] = json!(PROTOCOL_VERSION + 1);
        assert_eq!(message(respond(&state, body).await), UPDATE_NEEDED);
    }

    #[tokio::test]
    async fn a_wrong_token_is_rejected_before_anything_else() {
        let (state, _) = silent_server();
        let mut body = list();
        body["token"] = json!("nope");
        assert_eq!(
            message(respond(&state, body).await),
            "Invalid authentication token"
        );
    }

    #[tokio::test]
    async fn a_push_is_queued_with_its_sender() {
        let (state, seen) = silent_server();
        let body = request(json!({ "type": "push", "payload": "{}" }));
        assert!(matches!(
            respond(&state, body).await,
            SyncResponse::Success { .. }
        ));
        let received = state.received.lock().await;
        assert_eq!(received[0].peer.name, "Phone");
        assert!(seen.lock().unwrap().is_empty());
    }
}
