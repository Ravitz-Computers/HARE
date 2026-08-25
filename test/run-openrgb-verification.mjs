// Orchestrates the fake-OpenRGB-hardware verification: starts the
// simulated multi-device server, runs the backend checks against it, then
// tears the server down either way. This is what `npm run test:openrgb`
// actually invokes.
//
// Requires dist-electron/backend/openrgbBackend.js to exist first — the
// npm script runs `build:electron` before this automatically.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.HARE_TEST_OPENRGB_PORT || "6743";

function run(scriptPath, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => resolve({ child, code }));
  });
}

async function main() {
  console.log(`Starting simulated OpenRGB SDK server on 127.0.0.1:${PORT}...\n`);
  const server = spawn(process.execPath, [path.join(__dirname, "fake-openrgb-server.mjs")], {
    stdio: "inherit",
    env: { ...process.env, HARE_TEST_OPENRGB_PORT: PORT },
  });

  // Give the server a moment to bind before the client tries to connect.
  await new Promise((r) => setTimeout(r, 500));

  console.log("\nRunning verification against HARE's real OpenRGB backend...\n");
  const { code } = await run(path.join(__dirname, "verify-openrgb-backend.mjs"), {
    HARE_TEST_OPENRGB_PORT: PORT,
  });

  server.kill();

  if (code === 0) {
    console.log("\n✔ Device-database/backend verification passed.");
  } else {
    console.error("\n✘ Device-database/backend verification FAILED — see output above.");
    process.exit(code ?? 1);
  }

  // Second phase, its own dedicated (much simpler) server on the same now-
  // free port: proves a dropped connection after a successful connect
  // (OpenRGB closing/crashing, a socket reset) is handled gracefully
  // instead of crashing the whole process -- see that script's header for
  // the real incident this guards against.
  console.log("\nRunning connection-error-recovery verification...\n");
  const { code: recoveryCode } = await run(path.join(__dirname, "verify-openrgb-error-recovery.mjs"), {
    HARE_TEST_OPENRGB_PORT: PORT,
  });

  if (recoveryCode === 0) {
    console.log("\n✔ Connection-error-recovery verification passed.");
  } else {
    console.error("\n✘ Connection-error-recovery verification FAILED — see output above.");
    process.exit(recoveryCode ?? 1);
  }

  // Third phase: the same drop-the-connection scenario, but proving
  // BackendManager itself (not just OpenRgbBackend in isolation) reacts
  // correctly -- auto-falling-back to demo mode with the real reason.
  console.log("\nRunning BackendManager error-recovery verification...\n");
  const { code: managerCode } = await run(path.join(__dirname, "verify-manager-error-recovery.mjs"), {
    HARE_TEST_OPENRGB_PORT: PORT,
  });

  if (managerCode === 0) {
    console.log("\n✔ BackendManager error-recovery verification passed.");
  } else {
    console.error("\n✘ BackendManager error-recovery verification FAILED — see output above.");
    process.exit(managerCode ?? 1);
  }

  // Fourth phase: no live server needed -- proves deviceDatabase.ts's
  // application-level mitigation for extract-zip's unpatched symlink
  // path-traversal vulnerability (GHSA-jmr9-qjv8-65gv) actually rejects an
  // escaping symlink, and doesn't false-positive on a legitimate extracted
  // tree.
  console.log("\nRunning symlink-escape-guard verification...\n");
  const { code: symlinkCode } = await run(path.join(__dirname, "verify-symlink-escape-guard.mjs"), {});

  if (symlinkCode === 0) {
    console.log("\n✔ Symlink-escape-guard verification passed.");
  } else {
    console.error("\n✘ Symlink-escape-guard verification FAILED — see output above.");
  }
  process.exit(symlinkCode ?? 1);
}

main();
