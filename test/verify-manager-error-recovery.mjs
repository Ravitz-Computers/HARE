// One layer up from verify-openrgb-error-recovery.mjs: proves
// BackendManager itself reacts correctly to a live OpenRGB connection dying
// mid-session (see backendManager.ts's setBackend/fallbackToNoDevices) --
// not just that OpenRgbBackend survives it internally. Without this,
// BackendManager could still be stuck reporting a "connected" status with a
// stale device list forever after a connection drop, even though the
// underlying backend already recovered.
//
// Reuses fake-openrgb-server.mjs's real (non-zero) device lineup so
// BackendManager.start() takes the normal "found real devices, stay
// connected" path, then forces a real TCP RST to simulate OpenRGB
// crashing/closing.
//
// Run via `npm run test:openrgb` (which builds electron first) rather than
// directly.
import { DEVICES, startServer } from "./fake-openrgb-server.mjs";

const PORT = Number(process.env.HARE_TEST_OPENRGB_PORT) || 6743;
const { BackendManager } = await import("../dist-electron/backend/backendManager.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  OK: " + msg);
}

let sawUncaught = false;
process.on("uncaughtException", (err) => {
  sawUncaught = true;
  console.log("  FAIL: an uncaught exception reached the process (the bug is back): " + err.message);
  process.exit(1);
});

const server = await startServer();
console.log("");
let acceptedSocket = null;
server.on("connection", (socket) => {
  acceptedSocket = socket;
});

const manager = new BackendManager({ openRgbPort: PORT });
console.log("Starting BackendManager against a live (fake) OpenRGB server...");
await manager.start();

const before = manager.getState();
assert(before.status === "connected", `manager starts connected with real devices present, got status "${before.status}"`);
// One simulated device can only be read at an older protocol. The manager
// should end up with all of them, because the backend falls back rather than
// settling for the devices the newest protocol happened to manage.
assert(
  before.devices.length === DEVICES.length,
  `manager reports all ${DEVICES.length} simulated devices (got ${before.devices.length})`
);

console.log("\nForcing a real TCP RST from the server side (simulates OpenRGB crashing/closing)...");
assert(acceptedSocket !== null, "server accepted a connection to reset");
acceptedSocket.resetAndDestroy();

// Give the reset a moment to propagate through the socket -> Client ->
// OpenRgbBackend -> BackendManager's status listener -> fallbackToNoDevices's
// own async connect() -- several real async hops, not instantaneous.
await new Promise((r) => setTimeout(r, 800));

assert(!sawUncaught, "no uncaught exception reached the process");
const after = manager.getState();
assert(
  after.status === "error" && after.devices.length === 0,
  `manager auto-falls-back to an honest "no devices" state after the connection drops (no fake devices), got status "${after.status}" with ${after.devices.length} device(s)`
);
assert(
  (after.message || "").includes("Lost the connection to OpenRGB"),
  `the real reason is carried through to the UI-facing state, got "${after.message}"`
);

server.close();
console.log("\nALL_MANAGER_ERROR_RECOVERY_CHECKS_PASSED");
process.exit(0);
