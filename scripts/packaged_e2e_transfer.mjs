#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const APP_PATH = process.env.APP_PATH || "src-tauri/target/release/quicksend";
async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("failed to allocate free port"));
        }
      });
    });
    server.on("error", reject);
  });
}

async function ensureExecutable(filePath) {
  await access(filePath, constants.X_OK);
}

function spawnTauriDriver(extraEnv, options) {
  const args = ["--port", String(options.port), "--native-port", String(options.nativePort)];
  if (options.nativeHost) {
    args.push("--native-host", options.nativeHost);
  }
  if (options.nativeDriver) {
    args.push("--native-driver", options.nativeDriver);
  }

  const child = spawn("tauri-driver", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  child.on("error", () => {});
  return child;
}

async function waitForWebDriver(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/status`);
      if (res.ok) return;
    } catch {
      // wait and retry
    }
    await delay(250);
  }
  throw new Error(`tauri-driver was not ready at ${url} within ${timeoutMs}ms`);
}

async function openSession(webdriverUrl) {
  const capabilities = new Capabilities();
  capabilities.setBrowserName("wry");
  capabilities.set("tauri:options", { application: path.resolve(APP_PATH) });
  return await new Builder()
    .usingServer(webdriverUrl)
    .forBrowser("wry")
    .withCapabilities(capabilities)
    .build();
}

async function invokeCommand(driver, cmd, args = {}) {
  const result = await driver.executeAsyncScript(
    `
      const [command, payload, done] = arguments;
      window.__TAURI_INTERNALS__.invoke(command, payload)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    `,
    cmd,
    args,
  );

  if (!result?.ok) {
    throw new Error(`invoke(${cmd}) failed: ${result?.error ?? "unknown error"}`);
  }
  return result.value;
}

async function waitForFile(filePath, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await access(filePath, constants.R_OK);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`expected downloaded file not found: ${filePath}`);
}

async function run() {
  const root = await mkdtemp(path.join(os.tmpdir(), "quicksend-packaged-transfer-e2e-"));
  const senderWebdriverPort = await findFreePort();
  const senderNativePort = await findFreePort();
  const receiverWebdriverPort = await findFreePort();
  const receiverNativePort = await findFreePort();
  const senderWebdriverUrl = `http://127.0.0.1:${senderWebdriverPort}`;
  const receiverWebdriverUrl = `http://127.0.0.1:${receiverWebdriverPort}`;
  const homeDir = path.join(root, "home");
  const downloadsDir = path.join(homeDir, "Downloads");
  const senderInputDir = path.join(root, "sender-input");
  const senderFile = path.join(senderInputDir, "e2e-transfer.txt");
  const expectedOutFile = path.join(downloadsDir, "e2e-transfer.txt");

  await mkdir(downloadsDir, { recursive: true });
  await mkdir(senderInputDir, { recursive: true });
  await writeFile(senderFile, "packaged e2e transfer payload\n", "utf8");

  let senderDriver;
  let receiverDriver;
  let senderSession;
  let receiverSession;

  try {
    await ensureExecutable(APP_PATH);

    const probe = spawnSync("tauri-driver", ["--help"], { stdio: "ignore" });
    if (probe.error && probe.error.code === "ENOENT") {
      throw new Error("missing dependency: tauri-driver");
    }

    senderDriver = spawnTauriDriver({
      HOME: homeDir,
      QUICKSEND_THROTTLE_MS: "0",
    }, {
      port: senderWebdriverPort,
      nativePort: senderNativePort,
      nativeHost: process.env.TAURI_NATIVE_HOST,
      nativeDriver: process.env.TAURI_NATIVE_DRIVER,
    });
    receiverDriver = spawnTauriDriver({
      HOME: homeDir,
      QUICKSEND_THROTTLE_MS: "0",
    }, {
      port: receiverWebdriverPort,
      nativePort: receiverNativePort,
      nativeHost: process.env.TAURI_NATIVE_HOST,
      nativeDriver: process.env.TAURI_NATIVE_DRIVER,
    });

    await waitForWebDriver(senderWebdriverUrl);
    await waitForWebDriver(receiverWebdriverUrl);

    senderSession = await openSession(senderWebdriverUrl);
    receiverSession = await openSession(receiverWebdriverUrl);

    // Disable auto-download so the flow uses explicit Download button clicks.
    await invokeCommand(receiverSession, "settings_save", {
      settings: {
        downloadDir: "~/Downloads",
        theme: "system",
        autoDownloadMaxBytes: 0,
        autoInstallUpdates: true,
        sizeUnit: "jedec",
      },
    });

    const created = await invokeCommand(senderSession, "package_create", {
      files: [senderFile],
      roots: [senderInputDir],
    });
    const ticket = created.ticket;

    await receiverSession
      .wait(until.elementLocated(By.css('a[href="#/receive"]')), 10_000)
      .then((el) => el.click());
    await receiverSession
      .wait(until.elementLocated(By.css("#ticket-input")), 10_000)
      .then((el) => el.sendKeys(ticket));
    await receiverSession
      .wait(until.elementLocated(By.xpath("//button[normalize-space()='Preview Package']")), 10_000)
      .then((el) => el.click());

    const downloadBtn = await receiverSession.wait(
      until.elementLocated(By.xpath("//button[contains(., 'Download Package')]")),
      10_000,
    );
    if (await downloadBtn.isEnabled()) {
      await downloadBtn.click();
    }

    await receiverSession.wait(
      until.elementLocated(By.xpath("//button[contains(., 'Open files folder')]")),
      20_000,
    );

    await waitForFile(expectedOutFile, 20_000);

    console.log("Packaged desktop transfer E2E passed: receiver downloaded sender file.");
  } catch (error) {
    if (error?.message?.includes("missing dependency: tauri-driver")) {
      console.error("Packaged transfer E2E prerequisite missing: tauri-driver.");
      console.error("Linux also requires a native WebDriver backend (for example WebKitWebDriver).");
    }
    throw error;
  } finally {
    if (senderSession) await senderSession.quit().catch(() => {});
    if (receiverSession) await receiverSession.quit().catch(() => {});
    if (senderDriver) {
      senderDriver.kill("SIGTERM");
      await delay(300);
      if (!senderDriver.killed) senderDriver.kill("SIGKILL");
    }
    if (receiverDriver) {
      receiverDriver.kill("SIGTERM");
      await delay(300);
      if (!receiverDriver.killed) receiverDriver.kill("SIGKILL");
    }
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
