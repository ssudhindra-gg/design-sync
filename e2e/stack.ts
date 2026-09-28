// Starts and stops ../docker-compose.yaml for the browser tests.
//
// The stack runs under its own compose project name and host port, so it never
// touches a `docker compose up` you already have running, nor the pytest
// compose suite (port 18000). It is deleted, volume included, afterwards.

import { execFileSync } from "node:child_process";
import path from "node:path";

const COMPOSE_FILE = path.resolve(__dirname, "..", "docker-compose.yaml");
const PROJECT = "design-sync-e2e";
export const APP_PORT = process.env.E2E_APP_PORT ?? "18001";
// E2E_BASE_URL runs the suite against an already running deployment (such as
// the AWS stack from infra/deploy.sh) instead of starting docker compose here.
export const EXTERNAL_URL = process.env.E2E_BASE_URL?.replace(/\/+$/, "") || undefined;
export const BASE_URL = EXTERNAL_URL ?? `http://localhost:${APP_PORT}`;

export function compose(...args: string[]): string {
  // APP_PORT goes on every call, not just `up`, so nothing recreates the app on
  // the default port.
  //
  // --progress plain: stderr is the user's terminal but stdout is our pipe, and
  // compose's default progress mode sees the terminal, picks its interactive
  // display, then fails on Windows with "failed to get console: The handle is
  // invalid".
  const argv = ["compose", "-f", COMPOSE_FILE, "-p", PROJECT, "--progress", "plain", ...args];
  return execFileSync("docker", argv, {
    env: { ...process.env, APP_PORT },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export async function waitUntilServing(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE_URL}/openapi.json`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = EXTERNAL_URL ? "" : `:\n${compose("logs", "--tail", "50")}`;
  throw new Error(`app did not answer on ${BASE_URL} within ${timeoutMs / 1000}s${logs}`);
}
