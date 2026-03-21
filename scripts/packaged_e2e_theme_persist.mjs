#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
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
  child.on("error", () => {
    // handled by caller via readiness timeout/failure checks
  });
  return child;
}

async function waitForWebDriver(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/status`);
      if (res.ok) {
        return;
      }
    } catch {
      // waiting for driver startup
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

async function selectDarkTheme(driver) {
  const settingsBtn = await driver.wait(
    until.elementLocated(By.css('[aria-label="Open settings"]')),
    10_000,
  );
  await settingsBtn.click();

  const themeSelectTrigger = await driver.wait(
    until.elementLocated(
      By.xpath("//label[normalize-space()='Theme']/following::button[1]"),
    ),
    10_000,
  );
  await themeSelectTrigger.click();

  const darkOption = await driver.wait(
    until.elementLocated(By.xpath("//*[normalize-space()='Dark']")),
    10_000,
  );
  await darkOption.click();

  await delay(400);
}

async function htmlHasDarkClass(driver) {
  return await driver.executeScript(
    "return document.documentElement.classList.contains('dark')",
  );
}

async function run() {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "quicksend-packaged-e2e-"));
  const webdriverPort = await findFreePort();
  const nativePort = await findFreePort();
  const webdriverUrl = `http://127.0.0.1:${webdriverPort}`;

  let tauriDriver;
  let firstSession;
  let secondSession;
  try {
    await ensureExecutable(APP_PATH);
    const probe = spawnSync("tauri-driver", ["--help"], { stdio: "ignore" });
    if (probe.error && probe.error.code === "ENOENT") {
      throw new Error("missing dependency: tauri-driver");
    }

    tauriDriver = spawnTauriDriver({
      QUICKSEND_CONFIG_DIR: configRoot,
      QUICKSEND_THROTTLE_MS: "0",
    }, {
      port: webdriverPort,
      nativePort,
      nativeHost: process.env.TAURI_NATIVE_HOST,
      nativeDriver: process.env.TAURI_NATIVE_DRIVER,
    });

    await waitForWebDriver(webdriverUrl);

    firstSession = await openSession(webdriverUrl);
    await selectDarkTheme(firstSession);

    const darkOnFirst = await htmlHasDarkClass(firstSession);
    if (!darkOnFirst) {
      throw new Error("expected first session to be in dark mode after selecting Dark");
    }
    await firstSession.quit();
    firstSession = undefined;

    secondSession = await openSession(webdriverUrl);
    await delay(700);

    const darkOnRelaunch = await htmlHasDarkClass(secondSession);
    if (!darkOnRelaunch) {
      throw new Error("expected dark mode to persist after relaunch, but it did not");
    }

    console.log("Packaged desktop E2E passed: theme persists across relaunch.");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.error("Packaged desktop E2E prerequisite missing.");
      console.error("Ensure `tauri-driver` is installed and in PATH.");
      console.error("Linux also requires a native WebDriver backend (e.g. WebKitWebDriver).");
    }
    throw error;
  } finally {
    if (firstSession) {
      await firstSession.quit().catch(() => {});
    }
    if (secondSession) {
      await secondSession.quit().catch(() => {});
    }
    if (tauriDriver) {
      tauriDriver.kill("SIGTERM");
      await delay(300);
      if (!tauriDriver.killed) {
        tauriDriver.kill("SIGKILL");
      }
    }
    await rm(configRoot, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
