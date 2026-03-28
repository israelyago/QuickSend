use std::path::{Path, PathBuf};

use crate::iroh::SourceFile;

pub fn expand_input_paths(raw_paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();

    for raw in raw_paths {
        let path = std::fs::canonicalize(&raw)
            .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            collect_dir_files(&path, &mut files)?;
        } else if metadata.is_file() {
            files.push(path);
        } else {
            return Err(format!(
                "path is not a file or directory: {}",
                path.display()
            ));
        }
    }

    if files.is_empty() {
        return Err("no files found in selection".to_string());
    }

    Ok(files)
}

pub fn collect_dir_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|err| format!("failed to read dir {}: {err}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("failed to read dir entry: {err}"))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            collect_dir_files(&path, files)?;
        } else if metadata.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

pub fn sum_file_sizes(files: &[PathBuf]) -> Result<u64, String> {
    files.iter().try_fold(0_u64, |acc, path| {
        let metadata = std::fs::metadata(path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;
        Ok(acc.saturating_add(metadata.len()))
    })
}

pub fn build_source_files(
    files: Vec<String>,
    roots: Option<Vec<String>>,
) -> Result<Vec<SourceFile>, String> {
    let canonical_roots = if let Some(values) = roots {
        let mut roots = Vec::new();
        for raw in values {
            if raw.is_empty() {
                continue;
            }
            let canonical = std::fs::canonicalize(&raw)
                .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
            roots.push(canonical);
        }
        roots.sort_by_key(|path| path.as_os_str().len());
        roots.into_iter().fold(Vec::new(), |mut acc, root| {
            if acc.iter().any(|parent: &PathBuf| root.starts_with(parent)) {
                return acc;
            }
            acc.push(root);
            acc
        })
    } else {
        Vec::new()
    };

    let mut results = Vec::new();
    for raw in files {
        let path = std::fs::canonicalize(&raw)
            .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
        let name = match find_relative_name(&path, &canonical_roots)? {
            Some(value) => value,
            None => path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("invalid UTF-8 file name: {}", path.display()))?
                .to_owned(),
        };
        results.push(SourceFile { path, name });
    }
    Ok(results)
}

pub fn find_relative_name(path: &Path, roots: &[PathBuf]) -> Result<Option<String>, String> {
    for root in roots {
        if path == root {
            return Ok(None);
        }
        if path.starts_with(root) {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| format!("failed to derive relative path for {}", path.display()))?;
            let mut parts = Vec::new();
            for part in relative.components() {
                let value = part
                    .as_os_str()
                    .to_str()
                    .ok_or_else(|| format!("invalid UTF-8 path segment: {}", path.display()))?;
                if value.is_empty() {
                    continue;
                }
                parts.push(value);
            }
            if parts.is_empty() {
                return Ok(None);
            }
            return Ok(Some(parts.join("/")));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{build_source_files, find_relative_name, sum_file_sizes};

    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("quicksend-files-{prefix}-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn find_relative_name_returns_relative_with_forward_slashes() {
        let root = PathBuf::from("/tmp/base");
        let file = PathBuf::from("/tmp/base/dir/file.txt");
        let rel = find_relative_name(&file, &[root]).expect("relative name");
        assert_eq!(rel.as_deref(), Some("dir/file.txt"));
    }

    #[test]
    fn build_source_files_uses_root_relative_names() {
        let base = unique_temp_dir("build-source");
        let root = base.join("root");
        let nested = root.join("a");
        fs::create_dir_all(&nested).expect("create nested");
        let file = nested.join("b.txt");
        fs::write(&file, b"hello").expect("write file");

        let out = build_source_files(
            vec![file.display().to_string()],
            Some(vec![root.display().to_string()]),
        )
        .expect("build source files");

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "a/b.txt");

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn sum_file_sizes_adds_file_lengths() {
        let base = unique_temp_dir("sum");
        let a = base.join("a.txt");
        let b = base.join("b.txt");
        fs::write(&a, b"12345").expect("write a");
        fs::write(&b, b"123").expect("write b");

        let total = sum_file_sizes(&[a, b]).expect("sum file sizes");
        assert_eq!(total, 8);

        let _ = fs::remove_dir_all(base);
    }
}
