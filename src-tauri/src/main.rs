#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use std::{path::{Path, PathBuf}, str::FromStr};
use anyhow::{anyhow, Result};
use iroh::{base::node_addr::AddrInfoOptions, blobs::{export::ExportProgress, store::{ExportFormat, ExportMode}}, client::{docs::{ImportProgress, ShareMode}, MemIroh as Iroh}, docs::{store::Query, AuthorId, DocTicket}, util::fs};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use futures_lite::stream::StreamExt;

type IrohNode = iroh::node::Node<iroh::blobs::store::fs::Store>;

// setup an iroh node
async fn setup<R: tauri::Runtime>(handle: tauri::AppHandle<R>) -> Result<()> {
    // get the applicaiton data root, join with "iroh_data" to get the data root for the iroh node
    let data_root = handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| anyhow!("can't get application data directory"))?
        .join("iroh_data");

    println!("Data root set to: {:?}", data_root);

    // create the iroh node
    let node = iroh::node::Node::persistent(data_root)
        .await?
        .spawn()
        .await?;

    let current_author = node.client().authors().create().await?;

    handle.manage(AppState::new(node, current_author));

    Ok(())
}

struct AppState {
    iroh: IrohNode,
    author: AuthorId,
}
impl AppState {
    fn new(iroh: IrohNode, author: AuthorId) -> Self {
        AppState {
            iroh,
            author,
        }
    }

    fn iroh(&self) -> Iroh {
        self.iroh.client().clone()
    }

}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
            }

            tauri::async_runtime::spawn(async move {
                println!("starting backend...");
                if let Err(err) = setup(handle).await {
                    eprintln!("failed: {:?}", err);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_blob,
            get_share_code,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct GetBlob {
    blob_ticket: String,
}

#[tauri::command]
async fn get_blob(state: tauri::State<'_, AppState>, get_blob_request: GetBlob) -> Result<String, String> {
    let ticket = DocTicket::from_str(&get_blob_request.blob_ticket).map_err(|e| e.to_string())?;
     
    let response = state.iroh().docs().import(ticket.clone()).await.map_err(|e| e.to_string())?;

    let download_folder = match dirs_next::download_dir() {
        Some(dir) => dir,
        None => {
            return Err("Download dir not found".to_string());
        },
    };

    let output: PathBuf = [download_folder, "quick_send".into()].iter().collect();

    println!("Output path set to {:?}", output);
    
    let mut entries = response.get_many(Query::all()).await.map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next().await {
        let entry = entry.map_err(|e| e.to_string())?;
        let mut name: String = String::from(String::from_utf8_lossy(entry.key()));
        if name.len() >= 2 {
            name.remove(name.len()-1);
        }

        let dest: PathBuf = Path::new(&output).join(name.clone());
        println!("<Entry name: {:?}, key: {:?}, len: {:?}, dest: {:?}>", name, entry.key(), entry.content_len(), dest);
        
        let exp_format = ExportFormat::Blob;
        let exp_mode = ExportMode::Copy;

        
        let mut stream = state
            .iroh()
            .blobs()
            .export(entry.content_hash(), dest, exp_format, exp_mode)
            .await
            .map_err(|e| e.to_string())?;

        while let Some(result) = stream.next().await {
            match result {
                Ok(progress) => {
                    match progress {
                        ExportProgress::Found { id, hash, size, outpath, meta: _meta } => {
                            println!("Found {}: {}, size {:?}, outpath {:?}", id, hash, size, outpath);
                        },
                        ExportProgress::Progress { id, offset } => {
                            println!("Progress {}: {}", id, offset);
                        },
                        ExportProgress::Done { id } => {
                            println!("Done {}.", id);
                            break;
                        },
                        ExportProgress::AllDone => {
                            println!("Alldone.");
                            break;
                        },
                        ExportProgress::Abort(e) => {
                            eprintln!("Abort: {}", e)
                        },
                    }
                },
                Err(err) => {
                    eprintln!("{}", err);
                },
            }

        }
        
    }
    Ok(format!("Files downloaded at {}", output.to_string_lossy()))
}


#[derive(Clone, Debug, Serialize, Deserialize)]
struct GetShareCodeRequest {
    files: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct GetShareCodeResponse {
    doc_ticket: String,
}

#[tauri::command]
async fn get_share_code(state: tauri::State<'_, AppState>, get_share_code_request: GetShareCodeRequest) -> Result<GetShareCodeResponse, String> {
    println!("{:?}", get_share_code_request);
    if get_share_code_request.files.is_empty() {
        return Err("Expected at least one valid file path".to_string());
    }
    let possible_paths: Result<Vec<PathBuf>, String> = get_share_code_request.files.iter().map(|f| {
        match PathBuf::from_str(f) {
            Ok(path) => Ok(path),
            Err(_e) => Err(format!("File path not properly formated. Got \"{:?}\"", f)),
        }
    }).collect();

    let paths = possible_paths?;

    let doc = state
        .iroh()
        .docs()
        .create()
        .await
        .map_err(|e| format!("Got an error when creating a doc. {:?}", e))?;

    for path in paths {
        let name = path.file_name().ok_or(format!("Could not find correct file name for {:?}", path.clone()))?;
        
        let key = fs::path_to_key(name, None, None).map_err(|e| format!("Error when converting path to key: {:?}", e))?;
        let mut r = doc
            .import_file(state.author, key, path.clone(), false)
            .await
            .map_err(|e| format!("Got an error when importing the file \"{:?}\". \"{:?}\"", path, e))?;

        while let Some(result) = r.next().await {
            match result {
                Ok(progress) => {
                    match progress {
                        ImportProgress::Found { id, name, size } => println!("Found {}: {}, size {:?}", id, name, size),
                        ImportProgress::Progress { id, offset } => println!("Progress {}: {}", id, offset),
                        ImportProgress::IngestDone { id, hash } => println!("Ingest Done {}: {}", id, hash),
                        ImportProgress::AllDone { key } => println!("All done. Entry key set to {:?}", key),
                        ImportProgress::Abort(e) => eprintln!("Operation aborted. Error: {:?}", e),
                    }
                },
                Err(err) => eprintln!("{}", err),
            }
        }
    }
    let doc_ticket = doc
        .share(ShareMode::Read, AddrInfoOptions::default())
        .await
        .map_err(|e| format!("Error when creating the ticket. {:?}", e))?;

    Ok(GetShareCodeResponse {
        doc_ticket: doc_ticket.to_string(),
    })
}
