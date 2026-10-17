use serde::Serialize;
use tauri::{Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct Generation<R: Runtime>(pub PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartArgs {
    title: String,
    subtitle: String,
    on_expire: Channel<serde_json::Value>,
    notify_on_expire: bool,
}

impl<R: Runtime> Generation<R> {
    pub fn start(
        &self,
        title: String,
        subtitle: String,
        on_expire: Channel<serde_json::Value>,
        notify_on_expire: bool,
    ) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>(
                "start",
                StartArgs {
                    title,
                    subtitle,
                    on_expire,
                    notify_on_expire,
                },
            )
            .map_err(|e| e.to_string())
    }

    pub fn stop(&self, outcome: Option<String>) -> Result<(), String> {
        #[derive(Serialize)]
        struct Args {
            outcome: Option<String>,
        }
        self.0
            .run_mobile_plugin::<()>("stop", Args { outcome })
            .map_err(|e| e.to_string())
    }

    pub fn update(&self, stage: String) -> Result<(), String> {
        #[derive(Serialize)]
        struct Args {
            stage: String,
        }
        self.0
            .run_mobile_plugin::<()>("update", Args { stage })
            .map_err(|e| e.to_string())
    }
}
