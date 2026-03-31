use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use iroh::{protocol::Router, Endpoint};
use iroh_blobs::api::Store;
use iroh_blobs::{
    api::blobs::AddProgressItem,
    api::remote::GetProgressItem,
    format::collection::Collection,
    get::request,
    protocol::{ChunkRanges, GetRequest},
    provider::events::{
        ConnectMode, EventMask, EventSender, ProviderMessage, RequestMode, ThrottleMode,
    },
    ticket::BlobTicket,
    BlobFormat, BlobsProtocol,
};
use n0_future::StreamExt;
use tokio::time::{timeout, Duration};

use crate::utils::mime::infer_mime_type;

pub struct IrohNode {
    store: Store,
    router: Option<Router>,
}

pub struct CreatedTicket {
    pub ticket: String,
    pub root_hash: String,
    pub served_hashes: Vec<String>,
}

pub struct SourceFile {
    pub path: PathBuf,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportPhase {
    Importing,
    Verifying,
}

pub struct PreviewFile {
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

pub struct CollectionPreview {
    pub package_id: String,
    pub files: Vec<PreviewFile>,
    pub total_size_bytes: u64,
}

impl IrohNode {
    fn log_error_chain(context: &str, err: &anyhow::Error) {
        eprintln!("[quicksend][preview] {context}: {err}");
        for (idx, cause) in err.chain().enumerate() {
            if idx == 0 {
                continue;
            }
            eprintln!("[quicksend][preview]   caused by: {cause}");
        }
    }

    pub async fn start_with_events(
        store: Store,
        endpoint: Endpoint,
        capture_events: bool,
    ) -> Result<(Self, tokio::sync::mpsc::Receiver<ProviderMessage>)> {
        let bind_start = Instant::now();
        println!(
            "[iroh][start] endpoint bind took: {:?}",
            bind_start.elapsed()
        );

        let (events_tx, events_rx) = if capture_events {
            let event_mask = EventMask {
                connected: ConnectMode::Notify,
                get: RequestMode::NotifyLog,
                get_many: RequestMode::NotifyLog,
                throttle: ThrottleMode::Intercept,
                ..EventMask::DEFAULT
            };
            EventSender::channel(128, event_mask)
        } else {
            EventSender::channel(1, EventMask::DEFAULT)
        };
        let blobs = BlobsProtocol::new(&store, Some(events_tx));
        let router = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();

        Ok((
            Self {
                store: store.into(),
                router: Some(router),
            },
            events_rx,
        ))
    }

    pub async fn create_collection_ticket(&self, files: &[SourceFile]) -> Result<CreatedTicket> {
        if files.is_empty() {
            return Err(anyhow!("at least one file is required"));
        }

        let mut collection = Collection::default();
        let mut served_hashes = Vec::new();

        for file in files {
            let absolute = std::fs::canonicalize(&file.path)
                .with_context(|| format!("failed to canonicalize {}", file.path.display()))?;

            if !absolute.is_file() {
                return Err(anyhow!("path is not a file: {}", absolute.display()));
            }

            let file_name = if file.name.is_empty() {
                absolute
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| {
                        anyhow!("file name must be valid UTF-8: {}", absolute.display())
                    })?
                    .to_owned()
            } else {
                file.name.clone()
            };

            let tag = self
                .store
                .blobs()
                .add_path(&absolute)
                .await
                .with_context(|| {
                    format!("failed to import {} into blob store", absolute.display())
                })?;

            served_hashes.push(tag.hash.to_string());
            collection.push(file_name, tag.hash);
        }

        let root = collection
            .store(&self.store)
            .await
            .context("failed to store collection metadata")?;

        self.store
            .tags()
            .create(root.hash_and_format())
            .await
            .context("failed to pin collection root in tag store")?;

        let root_hash = root.hash().to_string();
        served_hashes.push(root_hash.clone());
        let ticket = BlobTicket::new(self.endpoint().addr(), root.hash(), BlobFormat::HashSeq);
        Ok(CreatedTicket {
            ticket: ticket.to_string(),
            root_hash,
            served_hashes,
        })
    }

    pub async fn import_file_with_progress<F>(
        &self,
        file: &SourceFile,
        mut on_progress: F,
    ) -> Result<String>
    where
        F: FnMut(ImportPhase, u64, Option<u64>) -> bool,
    {
        let absolute = std::fs::canonicalize(&file.path)
            .with_context(|| format!("failed to canonicalize {}", file.path.display()))?;
        if !absolute.is_file() {
            return Err(anyhow!("path is not a file: {}", absolute.display()));
        }

        let mut stream = self.store.blobs().add_path(&absolute).stream().await;
        let mut total_bytes: Option<u64> = None;
        let mut processed_bytes: u64 = 0;

        while let Some(item) = stream.next().await {
            match item {
                AddProgressItem::Size(size) => {
                    total_bytes = Some(size);
                }
                AddProgressItem::CopyProgress(offset) => {
                    processed_bytes = offset;
                    if !on_progress(ImportPhase::Importing, processed_bytes, total_bytes) {
                        return Err(anyhow!("prepare import cancelled"));
                    }
                    continue;
                }
                AddProgressItem::OutboardProgress(offset) => {
                    processed_bytes = offset;
                    if !on_progress(ImportPhase::Verifying, processed_bytes, total_bytes) {
                        return Err(anyhow!("prepare import cancelled"));
                    }
                    continue;
                }
                AddProgressItem::CopyDone => {
                    if let Some(total) = total_bytes {
                        processed_bytes = total;
                    }
                    if !on_progress(ImportPhase::Importing, processed_bytes, total_bytes) {
                        return Err(anyhow!("prepare import cancelled"));
                    }
                    continue;
                }
                AddProgressItem::Done(temp_tag) => {
                    let hash = temp_tag.hash().to_string();
                    self.store
                        .tags()
                        .create(temp_tag.hash_and_format())
                        .await
                        .context("failed to create permanent tag for imported file")?;
                    if let Some(total) = total_bytes {
                        processed_bytes = total;
                    }
                    if !on_progress(ImportPhase::Verifying, processed_bytes, total_bytes) {
                        return Err(anyhow!("prepare import cancelled"));
                    }
                    return Ok(hash);
                }
                AddProgressItem::Error(err) => {
                    return Err(anyhow!(err).context("failed importing file into blob store"));
                }
            }
        }

        Err(anyhow!("unexpected end of import progress stream"))
    }

    pub async fn create_collection_ticket_from_hashes(
        &self,
        files: &[(String, String)],
    ) -> Result<CreatedTicket> {
        if files.is_empty() {
            return Err(anyhow!("at least one file is required"));
        }

        let mut collection = Collection::default();
        let mut served_hashes = Vec::new();

        for (name, hash) in files {
            let parsed_hash = hash
                .parse()
                .with_context(|| format!("invalid blob hash for {name}: {hash}"))?;
            collection.push(name.clone(), parsed_hash);
            served_hashes.push(hash.clone());
        }

        let root = collection
            .store(&self.store)
            .await
            .context("failed to store collection metadata")?;

        self.store
            .tags()
            .create(root.hash_and_format())
            .await
            .context("failed to pin collection root in tag store")?;

        let root_hash = root.hash().to_string();
        served_hashes.push(root_hash.clone());
        let ticket = BlobTicket::new(self.endpoint().addr(), root.hash(), BlobFormat::HashSeq);
        Ok(CreatedTicket {
            ticket: ticket.to_string(),
            root_hash,
            served_hashes,
        })
    }

    pub async fn fetch_collection_to_dir<F>(
        &self,
        ticket: &str,
        output_dir: impl AsRef<Path>,
        mut on_progress: F,
    ) -> Result<Vec<PathBuf>>
    where
        F: FnMut(u64),
    {
        let ticket: BlobTicket = ticket
            .parse()
            .context("failed to parse blob ticket for collection download")?;

        std::fs::create_dir_all(output_dir.as_ref()).with_context(|| {
            format!(
                "failed to create output directory {}",
                output_dir.as_ref().display()
            )
        })?;

        let conn = timeout(
            Duration::from_secs(5),
            self.endpoint()
                .connect(ticket.addr().clone(), iroh_blobs::ALPN),
        )
        .await
        .context("timed out connecting to iroh provider")?
        .context("failed to connect to iroh provider")?;

        let mut fetch = self
            .store
            .remote()
            .fetch(conn, ticket.hash_and_format())
            .stream();
        while let Some(item) = fetch.next().await {
            match item {
                GetProgressItem::Progress(bytes) => on_progress(bytes),
                GetProgressItem::Done(_) => break,
                GetProgressItem::Error(err) => {
                    return Err(anyhow!(
                        "failed fetching collection from remote node: {err}"
                    ));
                }
            }
        }

        let files = self.load_collection_files(ticket.hash()).await?;
        let mut exported_paths = Vec::with_capacity(files.len());

        for (name, hash, _) in files {
            let relative = sanitize_collection_path(&name)?;
            let target = output_dir.as_ref().join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).with_context(|| {
                    format!("failed creating output directory {}", parent.display())
                })?;
            }
            self.store
                .blobs()
                .export(hash, &target)
                .await
                .with_context(|| format!("failed exporting blob to {}", target.display()))?;
            exported_paths.push(target);
        }

        Ok(exported_paths)
    }

    pub async fn preview_collection(&self, ticket: &str) -> Result<CollectionPreview> {
        let ticket: BlobTicket = ticket
            .parse()
            .context("failed to parse blob ticket for preview")?;

        let conn = timeout(
            Duration::from_secs(10),
            self.endpoint()
                .connect(ticket.addr().clone(), iroh_blobs::ALPN),
        )
        .await
        .context("timed out connecting to iroh provider")?
        .context("failed to connect to iroh provider")?;

        let request = GetRequest::builder()
            .root(ChunkRanges::all())
            .child(0, ChunkRanges::all())
            .build(ticket.hash());
        let at_start = iroh_blobs::get::fsm::start(conn.clone(), request, Default::default());
        let connected = at_start
            .next()
            .await
            .context("failed starting collection preview request")?;
        let iroh_blobs::get::fsm::ConnectedNext::StartRoot(start_root) = connected
            .next()
            .await
            .context("failed starting collection preview root")?
        else {
            return Err(anyhow!("unexpected preview state for collection root"));
        };

        let (end, hash_seq, collection) = Collection::read_fsm(start_root)
            .await
            .context("failed reading collection metadata for preview")?;
        let closing = match end {
            iroh_blobs::get::fsm::EndBlobNext::Closing(closing) => closing,
            iroh_blobs::get::fsm::EndBlobNext::MoreChildren(more) => more.finish(),
        };
        let _ = closing
            .next()
            .await
            .context("failed closing collection preview request");

        let names: Vec<String> = collection.iter().map(|(name, _)| name.clone()).collect();
        if names.len() + 1 != hash_seq.len() {
            return Err(anyhow!(
                "collection metadata and hash sequence length mismatch"
            ));
        }

        let mut total_size_bytes = 0_u64;
        let mut preview_files = Vec::with_capacity(names.len());

        for (idx, name) in names.iter().enumerate() {
            let hash = hash_seq
                .get(idx + 1)
                .ok_or_else(|| anyhow!("collection blob hash missing for {name}"))?;
            let size_bytes = match request::get_verified_size(&conn, &hash).await {
                Ok((size, _)) => size,
                Err(err) => {
                    let err =
                        anyhow!(err).context("failed fetching collection entry size for preview");
                    Self::log_error_chain("size_fetch_primary", &err);
                    let retry_conn = timeout(
                        Duration::from_secs(5),
                        self.endpoint()
                            .connect(ticket.addr().clone(), iroh_blobs::ALPN),
                    )
                    .await
                    .context("timed out connecting to iroh provider for preview size")?
                    .context("failed to connect to iroh provider for preview size")?;
                    request::get_verified_size(&retry_conn, &hash)
                        .await
                        .map(|(size, _)| size)
                        .context("failed fetching collection entry size for preview")?
                }
            };
            total_size_bytes = total_size_bytes.saturating_add(size_bytes);
            preview_files.push(PreviewFile {
                mime_type: infer_mime_type(name),
                name: name.to_string(),
                size_bytes,
            });
        }

        Ok(CollectionPreview {
            package_id: format!("pkg-{}", ticket.hash()),
            files: preview_files,
            total_size_bytes,
        })
    }

    pub async fn shutdown(mut self) -> Result<()> {
        if let Some(router) = self.router.take() {
            router
                .shutdown()
                .await
                .context("failed to shutdown iroh router")?;
        }
        Ok(())
    }

    fn endpoint(&self) -> &Endpoint {
        self.router
            .as_ref()
            .expect("router should be initialized")
            .endpoint()
    }

    async fn load_collection_files(
        &self,
        root_hash: iroh_blobs::Hash,
    ) -> Result<Vec<(String, iroh_blobs::Hash, u64)>> {
        let collection = Collection::load(root_hash, &self.store)
            .await
            .context("failed to read downloaded collection metadata")?;

        let mut files = Vec::with_capacity(collection.len());
        for (name, hash) in collection {
            let size = match self.store.blobs().status(hash).await {
                Ok(iroh_blobs::api::blobs::BlobStatus::Complete { size }) => size,
                Ok(iroh_blobs::api::blobs::BlobStatus::Partial { size }) => size.unwrap_or(0),
                _ => 0,
            };
            files.push((name, hash, size));
        }
        Ok(files)
    }
}

fn sanitize_collection_path(name: &str) -> Result<PathBuf> {
    let path = Path::new(name);
    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!("invalid file path in collection: {name}"));
            }
        }
    }
    if sanitized.as_os_str().is_empty() {
        return Err(anyhow!("invalid file path in collection: {name}"));
    }
    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use iroh::{address_lookup::MemoryLookup, RelayMode};
    use iroh_blobs::store::mem::MemStore;

    use super::*;

    impl IrohNode {
        pub async fn start() -> Result<Self> {
            let store = MemStore::new();
            let address_lookup = MemoryLookup::new();
            let endpoint = iroh::Endpoint::empty_builder()
                .relay_mode(RelayMode::Default)
                .address_lookup(address_lookup.clone())
                .bind()
                .await
                .context("failed to bind iroh endpoint")?;
            let (node, _rx) = Self::start_with_events(store.into(), endpoint, false).await?;
            Ok(node)
        }
    }

    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

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
    async fn local_roundtrip_collection_downloads_files() -> Result<()> {
        let base_dir = unique_temp_dir("m2")?;

        let input_dir = base_dir.join("input");
        let output_dir = base_dir.join("output");

        fs::create_dir_all(&input_dir)?;

        let file_a = input_dir.join("a.txt");
        let file_b = input_dir.join("b.txt");
        fs::write(&file_a, b"hello from quicksend milestone 2")?;
        fs::write(&file_b, b"another file")?;

        let (sender, receiver) = tokio::try_join!(IrohNode::start(), IrohNode::start())?;

        let ticket = sender
            .create_collection_ticket(&[
                SourceFile {
                    path: file_a.clone(),
                    name: "a.txt".to_string(),
                },
                SourceFile {
                    path: file_b.clone(),
                    name: "b.txt".to_string(),
                },
            ])
            .await?
            .ticket;

        let exported = receiver
            .fetch_collection_to_dir(&ticket, &output_dir, |_| {})
            .await?;

        assert_eq!(exported.len(), 2);

        let received_a = fs::read(output_dir.join("a.txt"))?;
        let received_b = fs::read(output_dir.join("b.txt"))?;

        assert_eq!(received_a, fs::read(file_a)?);
        assert_eq!(received_b, fs::read(file_b)?);

        let ticket_roundtrip: BlobTicket = ticket.parse()?;
        assert_eq!(ticket_roundtrip.to_string(), ticket);

        fs::remove_dir_all(base_dir)?;

        Ok(())
    }

    #[tokio::test]
    async fn preview_collection_is_metadata_only() -> Result<()> {
        let base_dir = unique_temp_dir("preview-metadata")?;
        let input_dir = base_dir.join("input");
        fs::create_dir_all(&input_dir)?;

        let file_a = input_dir.join("a.txt");
        let file_b = input_dir.join("b.bin");
        fs::write(&file_a, b"hello preview")?;
        fs::write(&file_b, vec![42_u8; 4096])?;

        let expected_size_a = fs::metadata(&file_a)?.len();
        let expected_size_b = fs::metadata(&file_b)?.len();

        let (sender, receiver) = tokio::try_join!(IrohNode::start(), IrohNode::start())?;

        let ticket = sender
            .create_collection_ticket(&[
                SourceFile {
                    path: file_a.clone(),
                    name: "a.txt".to_string(),
                },
                SourceFile {
                    path: file_b.clone(),
                    name: "b.bin".to_string(),
                },
            ])
            .await?
            .ticket;

        let preview = receiver.preview_collection(&ticket).await?;
        assert_eq!(preview.files.len(), 2);
        assert_eq!(preview.files[0].name, "a.txt");
        assert_eq!(preview.files[1].name, "b.bin");
        assert_eq!(preview.files[0].size_bytes, expected_size_a);
        assert_eq!(preview.files[1].size_bytes, expected_size_b);
        assert_eq!(
            preview.total_size_bytes,
            expected_size_a.saturating_add(expected_size_b)
        );

        let ticket_roundtrip: BlobTicket = ticket.parse()?;
        let load_from_local = Collection::load(ticket_roundtrip.hash(), &receiver.store).await;
        assert!(
            load_from_local.is_err(),
            "preview should not persist collection metadata/content in local store"
        );

        fs::remove_dir_all(base_dir)?;
        Ok(())
    }
}
