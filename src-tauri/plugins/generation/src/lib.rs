use tauri::{
    Runtime,
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
};

#[cfg(target_os = "ios")]
mod ios;

#[cfg(target_os = "ios")]
use ios::Generation;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_generation);

#[cfg(not(target_os = "ios"))]
const UNSUPPORTED: &str = "background generation is only available on iOS";

// Async so the wait for Swift's reply, which hops to the main thread, never sits on the main
// thread itself: a sync command runs there and would deadlock.
#[tauri::command]
async fn start<R: Runtime>(
    app: tauri::AppHandle<R>,
    title: String,
    subtitle: String,
    on_expire: Channel<serde_json::Value>,
    notify_on_expire: bool,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Generation<R>>()
                .start(title, subtitle, on_expire, notify_on_expire)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, title, subtitle, on_expire, notify_on_expire);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
async fn stop<R: Runtime>(app: tauri::AppHandle<R>, outcome: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || app.state::<Generation<R>>().stop(outcome))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, outcome);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
async fn update<R: Runtime>(
    app: tauri::AppHandle<R>,
    stage: String,
    notify_on_expire: Option<bool>,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Generation<R>>().update(stage, notify_on_expire)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, stage, notify_on_expire);
        Ok(())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("generation")
        .invoke_handler(tauri::generate_handler![start, stop, update])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                use tauri::Manager;
                app.manage(Generation(api.register_ios_plugin(init_plugin_generation)?));
            }
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
