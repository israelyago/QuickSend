use std::path::Path;

pub fn infer_mime_type(path: impl AsRef<Path>) -> String {
    let ext = path
        .as_ref()
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mime = match ext.as_str() {
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    };

    mime.to_string()
}

#[cfg(test)]
mod tests {
    use super::infer_mime_type;

    #[test]
    fn infers_known_types_case_insensitive() {
        assert_eq!(infer_mime_type("photo.JPG"), "image/jpeg");
        assert_eq!(infer_mime_type("readme.md"), "text/markdown");
        assert_eq!(infer_mime_type("data.json"), "application/json");
    }

    #[test]
    fn defaults_to_octet_stream_when_unknown() {
        assert_eq!(
            infer_mime_type("archive.unknown"),
            "application/octet-stream"
        );
        assert_eq!(infer_mime_type("no_extension"), "application/octet-stream");
    }
}
