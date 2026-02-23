import { watch } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PLAYBOOKS_DIR = join(process.cwd(), "playbooks");
let debounceTimer = null;
let isSyncRunning = false;
let rerunRequested = false;

function runSync() {
  if (isSyncRunning) {
    rerunRequested = true;
    return;
  }

  isSyncRunning = true;
  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "sync-playbooks.mjs")], {
    stdio: "inherit",
  });
  isSyncRunning = false;

  if (result.status !== 0) {
    console.error("[playbooks:watch] sync failed");
  }

  if (rerunRequested) {
    rerunRequested = false;
    runSync();
  }
}

runSync();

watch(PLAYBOOKS_DIR, { persistent: true }, (_eventType, fileName) => {
  if (!fileName || !fileName.endsWith(".md")) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runSync();
  }, 250);
});
