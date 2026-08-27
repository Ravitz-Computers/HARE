// Regression test for a real crash reported from a real Windows PC:
// "Uncaught exception: Error: read ECONNRESET at TCP.onStreamRead". Root
// cause: openrgb-sdk's Client re-emits its socket's "error" event, and
// Node's EventEmitter throws an "error" event with no listener as an
// uncaught exception -- so any connection drop *after* a successful
// connect (OpenRGB closing, crashing, a network hiccup) used to take down
// HARE's entire main process. Fixed in openrgbBackend.ts's
// `client.on("error", ...)` + `handleClientError`.
//
// This test proves the fix by doing the exact thing that used to crash the
// process: connect successfully, then force a real TCP RST from the server
// side (not just a clean close) so the client socket gets a genuine
// ECONNRESET, and asserts the Node process is still alive afterward and the
// backend reports a clean, recoverable "error" status instead.
//
// Run via `npm run test:openrgb` (which builds electron first) rather than
// directly.
import net from "node:net";

const PORT = Number(process.env.HARE_TEST_OPENRGB_PORT) || 6743;
const HEADER_SIZE = 16;
const { OpenRgbBackend } = await import("../dist-electron/backend/openrgbBackend.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  OK: " + msg);
}

function header(deviceId, commandId, length) {
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.write("ORGB", 0, "ascii");
  buf.writeUInt32LE(deviceId, 4);
  buf.writeUInt32LE(commandId, 8);
  buf.writeUInt32LE(length, 12);
  return buf;
}

// A previous run of this same suite (verify-openrgb-backend.mjs) would have
// left the process's own "uncaughtException"/"unhandledRejection" listeners
// alone -- this script runs as its own child process (see
// run-openrgb-verification.mjs), so it starts with Node's bare default
// behavior: an uncaught "error" event event genuinely crashes it. That's
// exactly what makes this a faithful reproduction of the real bug.
let sawUncaught = false;
process.on("uncaughtException", (err) => {
  sawUncaught = true;
  console.log("  FAIL: an uncaught exception reached the process (the bug is back): " + err.message);
  process.exit(1);
});

let acceptedSocket = null;
const server = net.createServer((socket) => {
  acceptedSocket = socket;
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= HEADER_SIZE) {
      const length = buf.readUInt32LE(12);
      if (buf.length < HEADER_SIZE + length) break;
      const commandId = buf.readUInt32LE(8);
      buf = buf.subarray(HEADER_SIZE + length);
      if (commandId === 0) {
        // getControllerCount -> 0 devices, so refreshDevices() resolves instantly.
        const body = Buffer.alloc(4);
        body.writeUInt32LE(0);
        socket.write(Buffer.concat([header(0, 0, 4), body]));
      }
      // Everything else (protocol version, etc.) is fine left unanswered --
      // openrgb-sdk's connect() tolerates that with its own timeout.
    }
  });
  socket.on("error", () => {
    /* expected once we reset it below -- the point of this test */
  });
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
console.log(`[test-server] listening on 127.0.0.1:${PORT}\n`);

const backend = new OpenRgbBackend({ host: "127.0.0.1", port: PORT, connectTimeoutMs: 5000 });

console.log("Connecting (should succeed normally)...");
await backend.connect();
assert(backend.getStatus() === "connected", "backend reports connected before the reset");

console.log("\nForcing a real TCP RST from the server side (simulates OpenRGB crashing/closing)...");
assert(acceptedSocket !== null, "server accepted a connection to reset");
acceptedSocket.resetAndDestroy();

// Give the reset a moment to actually propagate to the client socket and
// through handleClientError -- this is real async I/O, not instantaneous.
await new Promise((r) => setTimeout(r, 500));

assert(!sawUncaught, "no uncaught exception reached the process");
assert(backend.getStatus() === "error", `backend transitioned to an "error" status, got "${backend.getStatus()}"`);
assert(
  (backend.getStatusMessage() || "").includes("Lost the connection to OpenRGB"),
  `status message explains what happened, got "${backend.getStatusMessage()}"`
);

server.close();
console.log("\nALL_ERROR_RECOVERY_CHECKS_PASSED");
process.exit(0);
