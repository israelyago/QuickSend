# AI Context
QuickSend is a Tauri desktop app that uses `iroh`/`iroh-blobs` for peer-to-peer file transfer. The Rust backend lives under `src-tauri` and the UI runs via Vite in `src/`. Work flips between running `cargo tauri` commands and `pnpm` for the frontend.

The UI stack:

- TypeScript + React served through Vite and packaged by Tauri.
- State is in `src/store/appStore.ts` (zustand) and components subscribe to `listen` from `@tauri-apps/api/event`.
- Backend commands are invoked with `tauri.invoke`; layout/styles live under `src/layout` and pages in `src/pages`.
- The entry point `src/App.tsx` wires listeners, routing, and the shell components.

Key expectations for any assisting agent:

1. Understand the `src-tauri` backend drives previews/downloads via `IrohNode` and keeps throttling hooks plus session tracking in `lib.rs`.
2. Running `cargo test preview_collection_is_metadata_only -- --nocapture` exercises the preview logic; `make build-fast` builds without bundling. Always prove backend changes by running the relevant tests, and once they pass run `make build-fast` before reporting completion. When changing frontend or backend, you must build using `make build-fast` rather than calling `cargo tauri build` directly. `make manual-test` is referenced here for humans only—use it to spin up multiple instances with per-instance logs in `/tmp/quicksend-manual-test-instances/logs` when requested.
2b. Any time code changes are made, run `make build-fast` before finishing up.
3. Watch for the `manual-test` Makefile behavior: logs are redirected, throttle is configurable via `THROTTLE_MS`, and you can skip the build via `ARGS=--skip-build` (humans run this command).
4. Keep changes focused on the requested milestone/bug; avoid touching unrelated files or reverting user edits.

UI + shadcn notes:

- Shadcn components are generated into `src/components/ui/` (not a runtime dependency).
- `components.json` and `tailwind.config.ts` are required for the shadcn CLI/MCP tooling.
- Vite alias `@` -> `src` is required because shadcn components import from `@/lib/utils`.
- Tailwind v4 token wiring lives in `src/index.css` (look for `@theme inline` and `:root` tokens). This is required for `bg-primary` and other shadcn classes.
- Each app instance uses its own iroh store under `temp_dir/quicksend/iroh-node/<id>` and the directory is cleaned on shutdown.

If you ever need more context, inspect `src-tauri/src/iroh.rs` for transfer logic and `src-tauri/src/lib.rs` for session/event handlers; those are the high-leverage areas for fixes.
