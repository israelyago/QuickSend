pub mod api;
pub mod commands;
pub mod iroh;
pub mod services;
mod state;
mod utils;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tauri::{Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{
    iroh::IrohNode,
    services::transfer::{
        cleanup_iroh_node_dir, configured_throttle_delay, run_provider_event_bridge,
    },
    state::{cancel_all_downloads, IrohAppState, PrepareRegistry, TransferRegistry},
    utils::ids::next_id,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = {
        builder.plugin(tauri_plugin_single_instance::init(|_, _, _| {
            // Deep link payload delivery is handled by the deep-link plugin event.
        }))
    };

    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::inspect_files,
            commands::package_prepare_start,
            commands::package_prepare_finalize,
            commands::package_prepare_add_files,
            commands::package_prepare_status,
            commands::package_prepare_cancel,
            commands::package_prepare_remove_file,
            commands::package_preview,
            commands::logs_dir,
            commands::open_logs_dir,
            commands::settings_load,
            commands::settings_save,
            commands::clipboard_ticket,
            commands::package_download,
            commands::transfer_cancel
        ])
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                app.deep_link().register_all()?;
            }

            let instance_id = next_id("iroh");
            let node_dir = std::env::temp_dir()
                .join("quicksend")
                .join("iroh-node")
                .join(instance_id);
            let (node, events_rx) =
                tauri::async_runtime::block_on(IrohNode::start_with_events(&node_dir, true))?;

            let sessions = Arc::new(Mutex::new(HashMap::new()));
            let hash_to_session = Arc::new(Mutex::new(HashMap::new()));
            let downloads = Arc::new(Mutex::new(HashMap::new()));
            let registry =
                TransferRegistry::new(sessions.clone(), hash_to_session.clone(), downloads.clone());
            let prepare_sessions = Arc::new(Mutex::new(HashMap::new()));
            let prepare_registry = PrepareRegistry::new(prepare_sessions);
            let throttle_delay = configured_throttle_delay();

            tauri::async_runtime::spawn(run_provider_event_bridge(
                events_rx,
                app.handle().clone(),
                registry.clone(),
                throttle_delay,
            ));

            app.manage(IrohAppState {
                node: tokio::sync::Mutex::new(Some(Arc::new(node))),
                registry,
                prepare_registry,
                node_dir,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<IrohAppState>() {
                cancel_all_downloads(&state);
                let node = tauri::async_runtime::block_on(async {
                    let mut guard = state.node.lock().await;
                    guard.take()
                });
                let node_dir = state.node_dir.clone();
                if let Some(node) = node {
                    match Arc::try_unwrap(node) {
                        Ok(node) => {
                            if let Err(err) = tauri::async_runtime::block_on(node.shutdown()) {
                                eprintln!("failed to shutdown iroh node cleanly: {err}");
                            }
                        }
                        Err(_) => {
                            eprintln!("skipping iroh shutdown: node still has active references");
                        }
                    }
                }
                cleanup_iroh_node_dir(&node_dir);
            }
        }
    });
}
