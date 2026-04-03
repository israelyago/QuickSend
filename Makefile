SHELL := /bin/bash

INSTANCES ?= 2
THROTTLE_MS ?= 0
APP_NAME ?= quicksend
BIN := src-tauri/target/debug/$(APP_NAME)
TMP_ROOT := /tmp/$(APP_NAME)-manual-test-instances
LOG_ROOT := $(TMP_ROOT)/logs
SKIP_BUILD ?= 0
ifneq ($(filter --skip-build,$(ARGS)),)
SKIP_BUILD := 1
endif

BUILD_OR_SKIP = \
if [ "$(SKIP_BUILD)" = "0" ]; then \
  $(MAKE) --no-print-directory build-fast; \
else \
  echo "Skipping build (--skip-build)"; \
fi

.PHONY: build-fast manual-test desktop-e2e-smoke desktop-e2e-click desktop-e2e-transfer desktop-e2e-all test test-ui test-backend lint lint-ui lint-backend

build-fast:
	cargo tauri build --debug --no-bundle

manual-test:
	@set -euo pipefail; \
	$(BUILD_OR_SKIP); \
	mkdir -p "$(TMP_ROOT)"; \
	mkdir -p "$(LOG_ROOT)"; \
	pids=(); \
	cleanup() { \
	  for pid in "$${pids[@]:-}"; do \
	    if kill -0 "$$pid" >/dev/null 2>&1; then \
	      kill "$$pid" >/dev/null 2>&1 || true; \
	    fi; \
	  done; \
	}; \
	trap cleanup INT TERM EXIT; \
	for i in $$(seq 1 "$(INSTANCES)"); do \
	  inst_tmp="$(TMP_ROOT)/$$i"; \
	  mkdir -p "$$inst_tmp"; \
	  config_dir="$$inst_tmp/config"; \
	  mkdir -p "$$config_dir"; \
	  log_file="$(LOG_ROOT)/instance-$$i.log"; \
	  echo "Starting instance $$i with TMPDIR=$$inst_tmp QUICKSEND_THROTTLE_MS=$(THROTTLE_MS) (log: $$log_file)"; \
	  TMPDIR="$$inst_tmp" QUICKSEND_CONFIG_DIR="$$config_dir" QUICKSEND_THROTTLE_MS="$(THROTTLE_MS)" QUICKSEND_LOG_FILE="$$log_file" "$(BIN)" >"$$log_file" 2>&1 & \
	  pids+=("$$!"); \
	done; \
	echo "Running $${#pids[@]} instance(s). Press Ctrl+C to stop."; \
	wait

desktop-e2e-smoke:
	@set -euo pipefail; \
	$(BUILD_OR_SKIP); \
	./scripts/desktop_e2e_smoke.sh "$(BIN)"

desktop-e2e-click:
	@set -euo pipefail; \
	$(BUILD_OR_SKIP); \
	APP_PATH="$(BIN)" node scripts/packaged_e2e_theme_persist.mjs

desktop-e2e-transfer:
	@set -euo pipefail; \
	$(BUILD_OR_SKIP); \
	APP_PATH="$(BIN)" node scripts/packaged_e2e_transfer.mjs

desktop-e2e-all:
	@set -euo pipefail; \
	$(BUILD_OR_SKIP); \
	$(MAKE) --no-print-directory desktop-e2e-click ARGS=--skip-build; \
	$(MAKE) --no-print-directory desktop-e2e-transfer ARGS=--skip-build

lint-ui:
	@set -euo pipefail; \
	echo "Running ESLint..."; \
	pnpm lint; \
	echo "Running typecheck..."; \
	pnpm typecheck

lint-backend:
	@set -euo pipefail; \
	echo "Running clippy..."; \
	cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

lint:
	@set -euo pipefail; \
	$(MAKE) --no-print-directory lint-ui; \
	$(MAKE) --no-print-directory lint-backend

test-ui:
	@set -euo pipefail; \
	echo "Running pnpm tests..."; \
	pnpm test --run; \
	echo "Running visual tests..."; \
	pnpm test:visual

test-backend:
	@set -euo pipefail; \
	echo "Running cargo tests..."; \
	(cd src-tauri && cargo test)

test:
	@set -euo pipefail; \
	$(MAKE) --no-print-directory test-ui; \
	$(MAKE) --no-print-directory test-backend; \
	echo "Running desktop e2e tests..."; \
	$(MAKE) --no-print-directory desktop-e2e-all
