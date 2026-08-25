import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { copyFile, rm } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Electron's preload scripts run in a special, CommonJS-only loading context
// even in an app like HARE where everything else (main process, backend/*,
// renderer) is ESM -- this repo sets "type": "module" in package.json for
// the whole project. Left to plain tsc, preload.ts compiles to a plain
// dist-electron/preload.js, which Node/Electron then load as ESM (because
// of that root "type": "module") and instantly fail with "Cannot use
// import statement outside a module" the moment Electron tries to run it.
// That failure is silent from the app's perspective: contextBridge never
// runs, so window.hare simply doesn't exist, and the renderer falls back to
// its browser/demo-only mode (src/lib/browserBackend.ts) *forever* --
// including in the packaged app, regardless of whether OpenRGB is running
// fine in the main process. Bundling preload.ts into one self-contained
// CommonJS file with esbuild sidesteps the ESM/CJS mismatch entirely.
await build({
  entryPoints: [path.join(__dirname, "..", "electron", "preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  // Electron itself provides the `electron` module at runtime -- bundling
  // it in would be both wasteful and wrong (it's not a real npm package
  // from preload's perspective).
  external: ["electron"],
  outfile: path.join(__dirname, "..", "dist-electron", "preload.cjs"),
  logLevel: "info",
});

// The main electron/tsconfig.json build (which runs right before this
// script, and still needs to include preload.ts so `npm run typecheck`
// covers it) also emits a plain dist-electron/preload.js alongside it --
// that copy is the broken ESM one described above, entirely unused now that
// main.ts loads preload.cjs. Deleting it avoids shipping a second,
// non-functional preload script in the installer that could confuse anyone
// debugging this later.
await rm(path.join(__dirname, "..", "dist-electron", "preload.js"), { force: true });

// The input hook runs in a forked child process (see inputHook.ts for why),
// and its host script is hand-written CommonJS rather than something tsc
// compiles -- so it has to be copied into the build output explicitly, or the
// packaged app forks a path that doesn't exist and the Reactive effect
// silently never responds to input.
await copyFile(
  path.join(__dirname, "..", "electron", "backend", "inputHookHost.cjs"),
  path.join(__dirname, "..", "dist-electron", "backend", "inputHookHost.cjs")
);
