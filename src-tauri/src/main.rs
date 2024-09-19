#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use anyhow::{anyhow, Result};
use futures_lite::stream::StreamExt;
use iroh::{
    base::node_addr::AddrInfoOptions,
    blobs::{
        export::ExportProgress,
        store::{ExportFormat, ExportMode},
    },
    client::{
        docs::{ImportProgress, ShareMode},
        Doc, MemIroh as Iroh,
    },
    docs::{store::Query, AuthorId, DocTicket},
    util::fs,
};
use log::{error, info, trace, LevelFilter};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    str::FromStr,
};
use tauri::Manager;
use tauri_plugin_log::LogTarget;

type IrohNode = iroh::node::Node<iroh::blobs::store::fs::Store>;

// setup an iroh node
async fn setup<R: tauri::Runtime>(handle: tauri::AppHandle<R>) -> Result<()> {
    // get the applicaiton data root, join with "iroh_data" to get the data root for the iroh node
    let data_root = handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| anyhow!("can't get application data directory"))?
        .join("iroh_data");

    info!("Data root set to: {:?}", data_root);

    // create the iroh node
    let node = iroh::node::Node::persistent(data_root)
        .await?
        .spawn()
        .await?;

    let current_author = node.client().authors().create().await?;

    let current_doc = node.docs().create().await?;

    handle.manage(AppState::new(node, current_author, current_doc));

    Ok(())
}

struct AppState {
    iroh: IrohNode,
    author: AuthorId,
    doc: Doc,
}
impl AppState {
    fn new(iroh: IrohNode, author: AuthorId, doc: Doc) -> Self {
        AppState { iroh, author, doc }
    }

    fn iroh(&self) -> Iroh {
        self.iroh.client().clone()
    }

    fn doc(&self) -> Doc {
        self.doc.clone()
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([LogTarget::LogDir, LogTarget::Stdout, LogTarget::Webview])
                .level(LevelFilter::Warn)
                .level_for(String::from("quick_send"), LevelFilter::Trace)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
            }

            tauri::async_runtime::spawn(async move {
                info!("starting backend...");
                if let Err(err) = setup(handle).await {
                    error!("failed: {:?}", err);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_blob,
            get_share_code,
            append_file,
            remove_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct GetBlob {
    blob_ticket: String,
}

#[derive(Clone, serde::Serialize)]
struct DownloadQueueAppend {
    id: String,
    size: u64,
    name: String,
}

#[derive(Clone, serde::Serialize)]
struct DownloadQueueProgress {
    id: String,
    offset: u64,
}

#[tauri::command]
async fn get_blob(
    state: tauri::State<'_, AppState>,
    get_blob_request: GetBlob,
    handle: tauri::AppHandle,
) -> Result<String, String> {
    let ticket = DocTicket::from_str(&get_blob_request.blob_ticket).map_err(|e| e.to_string())?;

    let doc = state
        .iroh()
        .docs()
        .import(ticket.clone())
        .await
        .map_err(|e| e.to_string())?;

    let download_folder = match dirs_next::download_dir() {
        Some(dir) => dir,
        None => {
            return Err("Download dir not found".to_string());
        }
    };

    let output: PathBuf = [download_folder, "quick_send".into()].iter().collect();

    let mut entries = doc
        .get_many(Query::all())
        .await
        .map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next().await {
        let entry = entry.map_err(|e| e.to_string())?;
        let mut name: String = String::from(String::from_utf8_lossy(entry.key()));
        if name.len() >= 2 {
            name.remove(name.len() - 1);
        }

        let dest: PathBuf = Path::new(&output).join(name.clone());
        info!(
            "<Entry name: {:?}, key: {:?}, len: {:?}, dest: {:?}>",
            name,
            entry.key(),
            entry.content_len(),
            dest
        );

        let exp_format = ExportFormat::Blob;
        let exp_mode = ExportMode::Copy;

        let mut stream = state
            .iroh()
            .blobs()
            .export(entry.content_hash(), dest.clone(), exp_format, exp_mode)
            .await
            .map_err(|e| e.to_string())?;

        let file_id = dest.display().to_string();

        while let Some(result) = stream.next().await {
            match result {
                Ok(progress) => match progress {
                    ExportProgress::Found {
                        id,
                        hash,
                        size,
                        outpath,
                        meta: _meta,
                    } => {
                        trace!(
                            "Found {}: {}, size {:?}, outpath {:?}",
                            id,
                            hash,
                            size,
                            outpath
                        );
                        let payload = DownloadQueueAppend {
                            id: file_id.clone(),
                            size: size.value(),
                            name: file_id.clone(),
                        };
                        let _ = handle.emit_all("download-queue-append", payload);
                    }
                    ExportProgress::Progress { id, offset } => {
                        trace!("Progress {}: {}", id, offset);
                        let payload = DownloadQueueProgress { id: file_id.clone(), offset };
                        let _ = handle.emit_all("download-queue-progress", payload);
                    }
                    ExportProgress::Done { id } => {
                        trace!("Done {}.", id);
                        let _ = handle.emit_all("download-queue-done", file_id.clone());
                        break;
                    }
                    ExportProgress::AllDone => {
                        break;
                    }
                    ExportProgress::Abort(e) => {
                        error!("Abort: {}", e);
                    }
                },
                Err(err) => {
                    error!("{}", err);
                }
            }
        }
    }
    Ok(format!("Files downloaded at {}", output.to_string_lossy()))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct GetShareCodeResponse {
    doc_ticket: String,
}

#[derive(Clone, serde::Serialize)]
struct UploadQueueAppend {
    id: String,
    size: u64,
    title: String,
}

#[derive(Clone, serde::Serialize)]
struct UploadQueueProgress {
    id: String,
    offset: u64,
}

#[derive(Clone, serde::Serialize)]
struct UploadQueueAllDone {
    id: String,
}

#[tauri::command]
async fn get_share_code(
    state: tauri::State<'_, AppState>,
) -> Result<GetShareCodeResponse, String> {

    let doc = state.doc();

    let doc_ticket = doc
        .share(ShareMode::Read, AddrInfoOptions::default())
        .await
        .map_err(|e| format!("Error when creating the ticket. {:?}", e))?;

    Ok(GetShareCodeResponse {
        doc_ticket: doc_ticket.to_string(),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AppendFileRequest {
    file_path: String,
}

#[tauri::command]
async fn append_file(
    state: tauri::State<'_, AppState>,
    append_file_request: AppendFileRequest,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    let path = PathBuf::from(append_file_request.file_path);
    import_file_to_iroh(&path, state.doc().clone(), state.author, handle.clone()).await?;
    Ok(())
}

async fn import_file_to_iroh(path: &Path, doc: Doc, author_id: AuthorId, handle: tauri::AppHandle) -> Result<(), String> {

    let name = path.file_name().ok_or("File does not have a name".to_string())?;
    let name = name.to_string_lossy().to_string();
    let key = fs::path_to_key(name.clone(), None, None)
        .map_err(|e| format!("Error when converting path to key: {:?}", e))?;

    let possible_entry = doc
        .get_exact(author_id, key.clone(), false)
        .await
        .map_err(|e| format!("Error when verifing if key is already taken. {:?}", e))?;

    if let Some(_entry) = possible_entry {
        return Err(format!("Duplicated file name '{}' is not allowed", name));
    }

    let mut r = doc
        .import_file(author_id, key, path, true)
        .await
        .map_err(|e| {
            format!(
                "Got an error when importing the file \"{:?}\". \"{:?}\"",
                path, e
            )
        })?;
    
    let file_id = path.display().to_string();

    while let Some(result) = r.next().await {
        match result {
            Ok(progress) => match progress {
                ImportProgress::Found { id: _, name, size } => {
                    let payload = UploadQueueAppend {
                        id: file_id.clone(),
                        size,
                        title: name.clone(),
                    };
                    let _ = handle.emit_all("upload-queue-append", payload);
                }
                ImportProgress::Progress { id: _, offset } => {
                    let payload = UploadQueueProgress { id: file_id.clone(), offset };
                    let _ = handle.emit_all("upload-queue-progress", payload);
                }
                ImportProgress::IngestDone { id: _, hash: _ } => {
                    let payload = UploadQueueAllDone { id: file_id.clone() };
                    let _ = handle.emit_all("upload-queue-alldone", payload);
                }
                ImportProgress::AllDone { key: _ } => {}
                ImportProgress::Abort(e) => error!("Operation aborted. Error: {:?}", e),
            },
            Err(err) => error!("{}", err),
        }
    }

    Ok(())
}


#[derive(Clone, Debug, Serialize, Deserialize)]
struct RemoveFileRequest {
    file_path: String,
}

#[tauri::command]
async fn remove_file(
    state: tauri::State<'_, AppState>,
    remove_file_request: RemoveFileRequest,
) -> Result<(), String> {

    let path = PathBuf::from(remove_file_request.file_path);

    let name = path.file_name().ok_or("File does not have a name".to_string())?;
    let name = name.to_string_lossy().to_string();

    let key = fs::path_to_key(name, None, None)
        .map_err(|e| format!("Error when converting path to key: {:?}", e))?;

    let _amount_deleted = state
    .doc()
    .del(state.author, key)
    .await
    .map_err(|e| format!("Error deleting the file from iroh. {:?}", e))?;

    Ok(())
}