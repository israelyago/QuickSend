use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use quicksend_lib::iroh::{IrohNode, SourceFile};

fn unique_temp_dir(prefix: &str) -> Result<PathBuf> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock before UNIX_EPOCH")?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("quicksend-{prefix}-{nanos}"));
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed creating temporary dir {}", dir.display()))?;
    Ok(dir)
}

#[tokio::test]
async fn sequential_collections_download_with_same_nodes() -> Result<()> {
    let base_dir = unique_temp_dir("sequential-roundtrip")?;
    let send_store_dir = base_dir.join("send-store");
    let recv_store_dir = base_dir.join("recv-store");
    let input_dir = base_dir.join("input");
    let output_dir_a = base_dir.join("output-a");
    let output_dir_b = base_dir.join("output-b");
    fs::create_dir_all(&input_dir)?;

    let file_a = input_dir.join("first.txt");
    let file_b = input_dir.join("second.txt");
    fs::write(&file_a, b"first package payload")?;
    fs::write(&file_b, b"second package payload")?;

    let sender = IrohNode::start(&send_store_dir).await?;
    let receiver = IrohNode::start(&recv_store_dir).await?;

    let ticket_a = sender
        .create_collection_ticket(&[SourceFile {
            path: file_a.clone(),
            name: "first.txt".to_string(),
        }])
        .await?
        .ticket;

    receiver
        .fetch_collection_to_dir(&ticket_a, &output_dir_a, |_| {})
        .await?;

    assert_eq!(
        fs::read(output_dir_a.join("first.txt"))?,
        fs::read(&file_a)?
    );

    let ticket_b = sender
        .create_collection_ticket(&[SourceFile {
            path: file_b.clone(),
            name: "second.txt".to_string(),
        }])
        .await?
        .ticket;

    receiver
        .fetch_collection_to_dir(&ticket_b, &output_dir_b, |_| {})
        .await?;

    assert_eq!(
        fs::read(output_dir_b.join("second.txt"))?,
        fs::read(&file_b)?
    );

    fs::remove_dir_all(base_dir)?;
    Ok(())
}
