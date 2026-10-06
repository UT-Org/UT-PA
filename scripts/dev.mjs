/** Cross-platform one-command launcher. No shell-built commands or npm shim spawning. */
import { connect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (!existsSync(path.join(root, "node_modules", "tsx"))) {
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (process.platform === "win32" && !existsSync(npmCli))
    throw new Error(
      "Install dependencies with npm ci first; the npm CLI could not be found beside Node.",
    );
  const install =
    process.platform === "win32"
      ? spawnSync(process.execPath, [npmCli, "ci"], { stdio: "inherit" })
      : spawnSync("npm", ["ci"], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const compose = spawnSync("docker", ["compose", "up", "-d", "temporal"], {
  stdio: "inherit",
});
if (compose.status !== 0) {
  console.error(
    "Could not start Temporal. Start Docker Desktop and try again.",
  );
  process.exit(compose.status ?? 1);
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Temporal did not become ready on port ${port}.`);
}

await waitForPort(7233);
const children = ["src/worker.ts", "src/api.ts"].map((file) =>
  spawn(process.execPath, ["--import", "tsx", file], { stdio: "inherit" }),
);
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => shutdown(0));
for (const child of children) {
  child.once("error", () => shutdown(1));
  child.once("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });
}
console.log(
  "Juniper is starting. App: http://localhost:3000 | Temporal UI: http://localhost:8233",
);
