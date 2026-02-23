import { spawn } from "node:child_process";

const useShell = process.platform === "win32";

const watcher = spawn("pnpm", ["playbooks:watch"], {
  stdio: "inherit",
  shell: useShell,
});

const convex = spawn(
  "npx",
  ["convex", "dev", "--tail-logs", "pause-on-deploy", "--run-sh", "pnpm playbooks:sync"],
  {
    stdio: "inherit",
    shell: useShell,
  },
);

let exiting = false;

function shutdown(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  watcher.kill("SIGTERM");
  convex.kill("SIGTERM");
  process.exit(code);
}

watcher.on("exit", (code) => {
  if (!exiting && code && code !== 0) {
    shutdown(code);
  }
});

convex.on("exit", (code) => {
  shutdown(code ?? 0);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
