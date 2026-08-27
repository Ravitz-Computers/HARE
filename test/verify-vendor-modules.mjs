// Exercises all six vendor-module integrations against simulated vendor
// software. Razer Chroma and SteelSeries GameSense both run against real
// local HTTP servers, because both genuinely are local REST APIs. Corsair
// iCUE, Logitech G HUB, ASUS Aura Sync and MSI Mystic Light run against fake
// native modules injected in place of cue-sdk, koffi and winax.
//
// WHAT THIS PROVES AND WHAT IT DOESN'T
//
// Each of these integrations is a translation: HARE's KLColor and intent, in
// one end; that vendor's own call shape and color encoding, out the other.
// Those encodings differ in ways that are easy to get backwards and
// impossible to notice by reading — Chroma packs colours BGR, Aura packs them
// GBR, Logitech takes 0-100 percentages rather than 0-255 bytes, and
// GameSense and Mystic Light take them unpacked. Get one wrong and the lights
// come on in the wrong colour, which reads as "the integration doesn't work"
// rather than "one shift is inverted".
//
// This checks HARE's side of every one of those conversions, plus the call
// ordering and the graceful-degradation paths. What it can't check is whether
// the documented call shapes match what the real vendor software expects —
// that needs the actual software installed. So: a pass here means any
// remaining fault is in the protocol description, not in HARE's handling of
// it, which is a much smaller search space.
import http from "node:http";
import { ChromaClient } from "../dist-electron/backend/vendors/chromaClient.js";
import { IcueClient } from "../dist-electron/backend/vendors/icueClient.js";
import { LogitechClient } from "../dist-electron/backend/vendors/logitechClient.js";
import { AuraClient } from "../dist-electron/backend/vendors/auraClient.js";
import { GamesenseClient } from "../dist-electron/backend/vendors/gamesenseClient.js";
import { MysticLightClient } from "../dist-electron/backend/vendors/mysticLightClient.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** Swaps in fake native modules for the duration of `run`. */
async function withFakeModules(map, run) {
  const { default: Module } = await import("node:module");
  const realLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(map, request)) return map[request];
    return realLoad.call(this, request, ...rest);
  };
  try {
    return await run();
  } finally {
    Module._load = realLoad;
  }
}

/** Forces the platform check inside each client to pass, so the real code path runs on Linux. */
function withPlatform(platform, run) {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  return Promise.resolve(run()).finally(() => Object.defineProperty(process, "platform", real));
}

console.log("Vendor modules, against simulated vendor software...\n");

// ===========================================================================
// Razer Chroma — a real HTTP server standing in for Synapse's local REST API.
// ===========================================================================
{
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/razer/chromasdk") {
        res.end(JSON.stringify({ uri: "http://localhost:54235/razer/chromasdk/session1", sessionid: 1 }));
      } else {
        res.end(JSON.stringify({ result: 0 }));
      }
    });
  });
  await new Promise((r) => server.listen(54235, "127.0.0.1", r));

  const chroma = new ChromaClient();
  const connected = await chroma.connect();
  check("Chroma: connects to the local SDK server", connected.ok === true);
  check("Chroma: reports itself connected afterwards", chroma.isConnected === true);

  const init = requests.find((r) => r.method === "POST" && r.url === "/razer/chromasdk");
  check("Chroma: registers with a POST to /razer/chromasdk", !!init);
  check(
    "Chroma: identifies HARE to Synapse rather than registering anonymously",
    init?.body?.title === "HARE" && typeof init?.body?.author?.name === "string"
  );
  check(
    "Chroma: declares the device categories it intends to drive",
    Array.isArray(init?.body?.device_supported) && init.body.device_supported.includes("keyboard")
  );

  requests.length = 0;
  // Pure red. Chroma packs color as 0x00BBGGRR, so red must arrive as 255 —
  // if the shifts were backwards it would arrive as 16711680 and light blue.
  const setRed = await chroma.setColor({ r: 255, g: 0, b: 0 });
  check("Chroma: accepts a color push", setRed.ok === true);

  const effectCalls = requests.filter((r) => r.method === "PUT" && !r.url.endsWith("/heartbeat"));
  check(`Chroma: pushes to every device category (${effectCalls.length} calls)`, effectCalls.length >= 5);
  check(
    "Chroma: uses the documented CHROMA_STATIC effect shape",
    effectCalls.every((c) => c.body?.effect === "CHROMA_STATIC" && typeof c.body?.param?.color === "number")
  );
  check(
    `Chroma: packs red as BGR (got ${effectCalls[0]?.body?.param?.color}, expected 255)`,
    effectCalls[0]?.body?.param?.color === 255
  );

  requests.length = 0;
  await chroma.setColor({ r: 0, g: 0, b: 255 });
  const bluePacked = requests.filter((r) => r.method === "PUT")[0]?.body?.param?.color;
  check(`Chroma: packs blue into the high byte (got ${bluePacked}, expected 16711680)`, bluePacked === 0xff0000);

  requests.length = 0;
  await chroma.setColor({ r: 18, g: 52, b: 86 });
  const mixed = requests.filter((r) => r.method === "PUT")[0]?.body?.param?.color;
  check(`Chroma: packs a mixed color correctly (got ${mixed}, expected ${(86 << 16) | (52 << 8) | 18})`,
    mixed === ((86 << 16) | (52 << 8) | 18));

  // The session expires without a periodic heartbeat, so one must actually fire.
  requests.length = 0;
  await new Promise((r) => setTimeout(r, 1400));
  check(
    "Chroma: sends the keep-alive heartbeat the SDK requires",
    requests.some((r) => r.method === "PUT" && r.url.endsWith("/heartbeat"))
  );

  requests.length = 0;
  await chroma.disconnect();
  check("Chroma: tears the session down with a DELETE", requests.some((r) => r.method === "DELETE"));
  check("Chroma: reports itself disconnected", chroma.isConnected === false);

  // And no heartbeat should keep firing after disconnect.
  requests.length = 0;
  await new Promise((r) => setTimeout(r, 1400));
  check("Chroma: stops heart-beating once disconnected", requests.length === 0);

  await new Promise((r) => server.close(r));
}

// Chroma with nothing listening must fail cleanly rather than hang or throw.
{
  const chroma = new ChromaClient();
  const result = await chroma.connect();
  check("Chroma: fails gracefully when Synapse isn't running", result.ok === false && !!result.message);
}

// ===========================================================================
// Corsair iCUE — fake cue-sdk native module.
// ===========================================================================
{
  const calls = [];
  const fakeCueSdk = {
    CorsairError: { CE_Success: 0 },
    CorsairSessionState: { CSS_Connected: 6, CSS_ConnectionRefused: 4, CSS_Timeout: 3 },
    CorsairDeviceType: { CDT_All: 0xffffffff },
    CorsairConnect(cb) {
      calls.push({ fn: "CorsairConnect" });
      setTimeout(() => cb({ data: { state: 6 } }), 5);
    },
    CorsairGetDevices(filter) {
      calls.push({ fn: "CorsairGetDevices", filter });
      return { error: 0, data: [{ id: "dev-a" }, { id: "dev-b" }] };
    },
    CorsairGetLedPositions(deviceId) {
      calls.push({ fn: "CorsairGetLedPositions", deviceId });
      return { error: 0, data: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    },
    CorsairSetLedColors(deviceId, leds) {
      calls.push({ fn: "CorsairSetLedColors", deviceId, leds });
      return { error: 0 };
    },
    CorsairDisconnect() {
      calls.push({ fn: "CorsairDisconnect" });
    },
  };

  await withFakeModules({ "cue-sdk": fakeCueSdk }, () =>
    withPlatform("win32", async () => {
      const icue = new IcueClient();
      const connected = await icue.connect();
      check("iCUE: connects once the SDK reports session state Connected", connected.ok === true);

      const result = await icue.setColor({ r: 10, g: 20, b: 30 });
      check("iCUE: reports a successful color push", result.ok === true);

      const sets = calls.filter((c) => c.fn === "CorsairSetLedColors");
      check(`iCUE: pushes to every reported device (${sets.length} of 2)`, sets.length === 2);
      check(
        "iCUE: sets every LED the device reported",
        sets.every((s) => s.leds.length === 3)
      );
      check(
        "iCUE: passes the requested color through unchanged, with full alpha",
        sets[0].leds.every((l) => l.r === 10 && l.g === 20 && l.b === 30 && l.a === 255)
      );
      check(
        "iCUE: keeps each LED's own id rather than renumbering them",
        sets[0].leds.map((l) => l.id).join(",") === "1,2,3"
      );
      check(
        "iCUE: asks for all device types, not a hardcoded subset",
        calls.find((c) => c.fn === "CorsairGetDevices")?.filter?.deviceTypeMask === 0xffffffff
      );

      await icue.disconnect();
      check("iCUE: disconnects cleanly", calls.some((c) => c.fn === "CorsairDisconnect"));
    })
  );
}

// A refused iCUE session must surface as an error, not a hang.
{
  const fake = {
    CorsairError: { CE_Success: 0 },
    CorsairSessionState: { CSS_Connected: 6, CSS_ConnectionRefused: 4, CSS_Timeout: 3 },
    CorsairDeviceType: { CDT_All: 0xffffffff },
    CorsairConnect: (cb) => setTimeout(() => cb({ data: { state: 4 } }), 5),
  };
  await withFakeModules({ "cue-sdk": fake }, () =>
    withPlatform("win32", async () => {
      const result = await new IcueClient().connect();
      check("iCUE: a refused connection is reported, not swallowed", result.ok === false && !!result.message);
    })
  );
}

// No devices reported is a distinct, honest outcome from "it worked".
{
  const fake = {
    CorsairError: { CE_Success: 0 },
    CorsairSessionState: { CSS_Connected: 6, CSS_ConnectionRefused: 4, CSS_Timeout: 3 },
    CorsairDeviceType: { CDT_All: 0xffffffff },
    CorsairConnect: (cb) => setTimeout(() => cb({ data: { state: 6 } }), 5),
    CorsairGetDevices: () => ({ error: 0, data: [] }),
  };
  await withFakeModules({ "cue-sdk": fake }, () =>
    withPlatform("win32", async () => {
      const icue = new IcueClient();
      await icue.connect();
      const result = await icue.setColor({ r: 1, g: 2, b: 3 });
      check("iCUE: 'no controllable devices' is reported rather than a false success", result.ok === false);
    })
  );
}

// ===========================================================================
// Logitech G HUB — fake koffi FFI binding.
// ===========================================================================
{
  const calls = [];
  let loadedName = null;
  const fakeKoffi = {
    load(name) {
      // The real G HUB DLL name is the least certain part of this
      // integration, so the fake refuses the first candidate to prove the
      // fallback actually works.
      if (name === "LogitechLedEnginesWrapper.dll") throw new Error("not found");
      loadedName = name;
      return {
        func(signature) {
          if (signature.includes("LogiLedInit")) return () => (calls.push({ fn: "init" }), true);
          if (signature.includes("LogiLedSetLighting"))
            return (r, g, b) => (calls.push({ fn: "set", r, g, b }), true);
          if (signature.includes("LogiLedShutdown")) return () => calls.push({ fn: "shutdown" });
          throw new Error("unexpected signature " + signature);
        },
      };
    },
  };

  await withFakeModules({ koffi: fakeKoffi }, () =>
    withPlatform("win32", async () => {
      const logi = new LogitechClient();
      const connected = await logi.connect();
      check("Logitech: falls back to the second DLL name when the first is missing", loadedName === "LogitechLed.dll");
      check("Logitech: initialises the SDK", connected.ok === true && calls.some((c) => c.fn === "init"));

      // The SDK takes 0-100 percentages, not 0-255 bytes. Sending 255 here
      // would be out of range and is exactly the kind of mistake that makes
      // an integration "not work" for a non-obvious reason.
      await logi.setColor({ r: 255, g: 0, b: 0 });
      const red = calls.find((c) => c.fn === "set");
      check(`Logitech: converts 255 to 100% (got ${red?.r})`, red?.r === 100 && red?.g === 0 && red?.b === 0);

      calls.length = 0;
      await logi.setColor({ r: 128, g: 64, b: 255 });
      const mixed = calls.find((c) => c.fn === "set");
      check(
        `Logitech: converts mid-range values proportionally (${mixed?.r},${mixed?.g},${mixed?.b})`,
        mixed?.r === 50 && mixed?.g === 25 && mixed?.b === 100
      );

      await logi.disconnect();
      check("Logitech: shuts the SDK down cleanly", calls.some((c) => c.fn === "shutdown"));
    })
  );
}

// Neither DLL present — G HUB isn't installed. Must degrade, not throw.
{
  const fakeKoffi = {
    load() {
      throw new Error("not found");
    },
  };
  await withFakeModules({ koffi: fakeKoffi }, () =>
    withPlatform("win32", async () => {
      const result = await new LogitechClient().connect();
      check("Logitech: missing DLL is reported as a clean failure", result.ok === false && !!result.message);
    })
  );
}

// ===========================================================================
// ASUS Aura Sync — fake winax COM automation.
// ===========================================================================
{
  const applied = [];
  const setColors = [];
  let progId = null;
  let switchedMode = false;

  function fakeLights(count) {
    const fn = (i) => ({
      set color(v) {
        setColors.push({ index: i, value: v });
      },
    });
    fn.Count = count;
    return fn;
  }

  function fakeDevices(count) {
    const fn = () => ({
      Lights: fakeLights(3),
      Apply: () => applied.push(true),
    });
    fn.Count = count;
    return fn;
  }

  const fakeWinax = {
    Object: function FakeComObject(id) {
      progId = id;
      return {
        SwitchMode: () => {
          switchedMode = true;
        },
        Enumerate: () => fakeDevices(2),
      };
    },
  };

  await withFakeModules({ winax: fakeWinax }, () =>
    withPlatform("win32", async () => {
      const aura = new AuraClient();
      const connected = await aura.connect();
      check("Aura: connects via the documented COM ProgID", connected.ok === true && progId === "aura.sdk.1");
      check("Aura: calls SwitchMode to take control from Aura's own software", switchedMode);

      // Aura packs color as 0x00GGBBRR — a different order from Chroma's BGR.
      const result = await aura.setColor({ r: 255, g: 0, b: 0 });
      check("Aura: reports a successful color push", result.ok === true);
      check(`Aura: sets every light on every device (${setColors.length} of 6)`, setColors.length === 6);
      check(`Aura: packs red as GBR (got ${setColors[0]?.value}, expected 255)`, setColors[0]?.value === 255);
      check(`Aura: applies the change per device (${applied.length} of 2)`, applied.length === 2);

      setColors.length = 0;
      await aura.setColor({ r: 0, g: 255, b: 0 });
      check(
        `Aura: packs green into the high byte (got ${setColors[0]?.value}, expected 16711680)`,
        setColors[0]?.value === 0xff0000
      );

      setColors.length = 0;
      await aura.setColor({ r: 18, g: 52, b: 86 });
      check(
        `Aura: packs a mixed color correctly (got ${setColors[0]?.value}, expected ${(52 << 16) | (86 << 8) | 18})`,
        setColors[0]?.value === ((52 << 16) | (86 << 8) | 18)
      );
    })
  );
}

// Aura's COM server absent (LightingService not running) must degrade cleanly.
{
  const fakeWinax = {
    Object: function () {
      throw new Error("Class not registered");
    },
  };
  await withFakeModules({ winax: fakeWinax }, () =>
    withPlatform("win32", async () => {
      const result = await new AuraClient().connect();
      check("Aura: an unreachable COM server is reported as a clean failure", result.ok === false);
    })
  );
}


// ===========================================================================
// SteelSeries GameSense — a real HTTP server standing in for SteelSeries GG,
// plus a real coreProps.json, since discovering the port from that file is
// half the integration.
// ===========================================================================
{
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  // GG publishes its address in coreProps.json under PROGRAMDATA. Point the
  // client at a temporary one rather than guessing a port — the whole reason
  // this file exists is that the port is not fixed.
  const fakeProgramData = mkdtempSync(path.join(os.tmpdir(), "hare-gg-"));
  const propsDir = path.join(fakeProgramData, "SteelSeries", "SteelSeries Engine 3");
  mkdirSync(propsDir, { recursive: true });
  writeFileSync(path.join(propsDir, "coreProps.json"), JSON.stringify({ address: `127.0.0.1:${port}` }));

  const realProgramData = process.env.PROGRAMDATA;
  process.env.PROGRAMDATA = fakeProgramData;

  await withPlatform("win32", async () => {
    const gg = new GamesenseClient();
    const connected = await gg.connect();
    check("GameSense: reads the port from coreProps.json rather than guessing", connected.ok === true);
    check("GameSense: reports itself connected", gg.isConnected === true);

    const meta = requests.find((r) => r.url === "/game_metadata");
    check("GameSense: registers itself with game_metadata", !!meta);
    check(
      "GameSense: uses an uppercase game name, as the API requires",
      meta?.body?.game === "HARE" && /^[A-Z0-9_-]+$/.test(meta.body.game)
    );

    requests.length = 0;
    const result = await gg.setColor({ r: 18, g: 52, b: 86 });
    check("GameSense: accepts a colour push", result.ok === true);

    const bind = requests.find((r) => r.url === "/bind_game_event");
    const fire = requests.find((r) => r.url === "/game_event");
    check("GameSense: binds a handler carrying the colour", !!bind);
    check("GameSense: then fires the event, without which nothing lights up", !!fire);
    check(
      "GameSense: binds handlers for every device capability, not just one",
      Array.isArray(bind?.body?.handlers) && bind.body.handlers.length >= 5
    );

    // Unlike every other vendor here, GameSense takes a plain object — no
    // bit-packing. Applying Chroma's or Aura's transformation by habit would
    // silently produce the wrong colour.
    const handler = bind?.body?.handlers?.[0];
    check(
      `GameSense: sends colour as plain {red,green,blue}, unpacked (${JSON.stringify(handler?.color)})`,
      handler?.color?.red === 18 && handler?.color?.green === 52 && handler?.color?.blue === 86
    );
    check("GameSense: uses the static colour mode", handler?.mode === "color");
    check("GameSense: targets every zone", handler?.zone === "all");

    requests.length = 0;
    await gg.disconnect();
    check("GameSense: unregisters so GG stops listing HARE as active", requests.some((r) => r.url === "/remove_game"));
    check("GameSense: reports itself disconnected", gg.isConnected === false);
  });

  process.env.PROGRAMDATA = realProgramData;
  rmSync(fakeProgramData, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
}

// GG not installed at all — no coreProps.json anywhere.
{
  const realProgramData = process.env.PROGRAMDATA;
  const empty = mkdtempSync(path.join(os.tmpdir(), "hare-gg-empty-"));
  process.env.PROGRAMDATA = empty;
  await withPlatform("win32", async () => {
    const result = await new GamesenseClient().connect();
    check("GameSense: a missing coreProps.json is reported as 'not installed', not an error", result.ok === false);
  });
  process.env.PROGRAMDATA = realProgramData;
  rmSync(empty, { recursive: true, force: true });
}

// ===========================================================================
// MSI Mystic Light — fake koffi binding, including the BSTR and SAFEARRAY
// marshalling that made this integration look harder than it is.
// ===========================================================================
{
  const calls = [];
  let loadedDlls = [];
  let allocatedBstrs = 0;
  let freedBstrs = 0;

  // A stand-in SAFEARRAY of BSTRs: two devices with 3 and 2 LEDs.
  const DEVICE_NAMES = ["MSI_MB", "MSI_VGA"];
  const LED_COUNTS = ["3", "2"];

  const fakeKoffi = {
    load(name) {
      loadedDlls.push(name);
      if (name === "MysticLight_SDK.dll") throw new Error("32-bit, cannot load");
      return {
        func(sig) {
          if (sig.includes("SysAllocString")) return () => (allocatedBstrs++, { bstr: allocatedBstrs });
          if (sig.includes("SysFreeString")) return () => freedBstrs++;
          if (sig.includes("MLAPI_Initialize")) return () => 0;
          if (sig.includes("MLAPI_GetDeviceInfo")) return (d, c) => { calls.push({ fn: "getDeviceInfo", d, c }); return 0; };
          if (sig.includes("MLAPI_SetLedColor"))
            return (type, index, r, g, b) => (calls.push({ fn: "set", type, index, r, g, b }), 0);
          throw new Error("unexpected signature " + sig);
        },
      };
    },
    alloc: (type, n) => ({ alloc: type, n }),
    struct: (name) => name,
    pointer: (t) => t + " *",
    as: (v) => v,
    decode(ptr, type, length) {
      // The two out-params, then the SAFEARRAY header, then the BSTR pointers.
      if (type === "void *" && length === undefined) return { safearray: ptr.alloc ? "devices" : "x" };
      if (type === "HARE_SAFEARRAY") return { cDims: 1, fFeatures: 0x0100, cElements: 2, pvData: { which: ptr } };
      if (type === "void *" && length) return [{ i: 0 }, { i: 1 }];
      if (type === "str16") return ptr.__name ?? "";
      return null;
    },
  };

  // The decode chain above can't tell devices from LED counts, so pin the
  // returned strings by order of use instead.
  let strReads = 0;
  fakeKoffi.decode = (ptr, type, length) => {
    if (type === "HARE_SAFEARRAY") return { cDims: 1, fFeatures: 0x0100, cElements: 2, pvData: {} };
    if (type === "void *" && length) return [{}, {}];
    if (type === "void *") return {};
    if (type === "str16") {
      const all = [...DEVICE_NAMES, ...LED_COUNTS];
      return all[strReads++] ?? "";
    }
    return null;
  };

  await withFakeModules({ koffi: fakeKoffi }, () =>
    withPlatform("win32", async () => {
      const msi = new MysticLightClient();
      const connected = await msi.connect();
      check("Mystic Light: connects through the SDK", connected.ok === true);
      check(
        "Mystic Light: loads the x64 DLL, which is what makes this possible at all",
        loadedDlls.includes("MysticLight_SDK_x64.dll")
      );
      check("Mystic Light: loads OleAut32 for BSTR handling", loadedDlls.includes("OleAut32.dll"));
      check("Mystic Light: enumerates devices rather than assuming a fixed list", calls.some((c) => c.fn === "getDeviceInfo"));

      const result = await msi.setColor({ r: 200, g: 100, b: 50 });
      check("Mystic Light: reports a successful colour push", result.ok === true);

      const sets = calls.filter((c) => c.fn === "set");
      // 3 LEDs on the first device + 2 on the second, read from the SAFEARRAY.
      check(`Mystic Light: writes every LED the SDK reported (${sets.length} of 5)`, sets.length === 5);
      check(
        "Mystic Light: passes RGB through unpacked, unlike Chroma and Aura",
        sets.every((c) => c.r === 200 && c.g === 100 && c.b === 50)
      );
      check(
        "Mystic Light: indexes LEDs from zero within each device",
        sets.filter((c) => c.index === 0).length === 2
      );
      check("Mystic Light: passes a real BSTR for the device type", allocatedBstrs > 0);
      // A leaked BSTR per call would accumulate fast on a 30fps effect loop.
      check(`Mystic Light: frees every BSTR it allocates (${freedBstrs}/${allocatedBstrs})`, freedBstrs === allocatedBstrs);

      await msi.disconnect();
      check("Mystic Light: disconnects cleanly", msi.isConnected === false);
    })
  );
}

// Initialise failing is almost always missing admin rights — say so.
{
  const fakeKoffi = {
    load: () => ({ func: (sig) => (sig.includes("MLAPI_Initialize") ? () => 5 : () => 0) }),
    alloc: () => ({}), struct: (n) => n, pointer: (t) => t, as: (v) => v, decode: () => null,
  };
  await withFakeModules({ koffi: fakeKoffi }, () =>
    withPlatform("win32", async () => {
      const result = await new MysticLightClient().connect();
      check("Mystic Light: a failed init names the likely cause rather than a bare code", 
        result.ok === false && /administrator/i.test(result.message));
    })
  );
}

// MSI Center not installed — no DLL to load.
{
  const fakeKoffi = {
    load: () => { throw new Error("not found"); },
    alloc: () => ({}), struct: (n) => n, pointer: (t) => t, as: (v) => v, decode: () => null,
  };
  await withFakeModules({ koffi: fakeKoffi }, () =>
    withPlatform("win32", async () => {
      const result = await new MysticLightClient().connect();
      check("Mystic Light: a missing DLL points at MSI Center rather than failing cryptically",
        result.ok === false && /MSI Center/i.test(result.message));
    })
  );
}

// ===========================================================================
// Bus-conflict detection.
//
// Motherboard, RAM and GPU lighting runs over SMBus/I2C, which tolerates one
// program at a time. OpenRGB's own docs say a second one can put a device
// into an invalid state and stop it being detected at all — so "no devices
// found" is very often "another RGB app is open", and nothing surfaces that
// unless it's looked for.
// ===========================================================================
{
  const { CONFLICTING_APPS, detectConflicts } = await import(
    "../dist-electron/backend/vendors/smbusConflicts.js"
  );

  check("the conflicting-app list is populated", CONFLICTING_APPS.length > 0);
  check(
    "it covers the board makers whose software fights for the bus",
    ["gigabyte-fusion", "asrock-polychrome", "msi-center", "asus-armoury"].every((id) =>
      CONFLICTING_APPS.some((a) => a.id === id)
    )
  );
  check(
    "it covers GPU vendor software too",
    ["evga-precision", "zotac-firestorm"].every((id) => CONFLICTING_APPS.some((a) => a.id === id))
  );
  check(
    "it covers competing universal RGB apps",
    CONFLICTING_APPS.some((a) => a.id === "signalrgb")
  );
  check(
    "every entry says what it takes over, so the warning is actionable",
    CONFLICTING_APPS.every((a) => typeof a.affects === "string" && a.affects.length > 0)
  );
  check(
    "process names are lowercase, since matching is case-insensitive",
    CONFLICTING_APPS.every((a) => a.processNames.every((n) => n === n.toLowerCase()))
  );
  check(
    "no entry is missing process names",
    CONFLICTING_APPS.every((a) => a.processNames.length > 0)
  );

  // Off Windows there is no tasklist, so detection must degrade to "nothing
  // found" rather than throwing.
  const found = await detectConflicts();
  check("detection returns cleanly off Windows rather than throwing", Array.isArray(found));
}

// ===========================================================================
// Cross-cutting: every client refuses to act before it's connected.
// ===========================================================================
{
  const results = await Promise.all([
    new ChromaClient().setColor({ r: 1, g: 1, b: 1 }),
    new IcueClient().setColor({ r: 1, g: 1, b: 1 }),
    new LogitechClient().setColor({ r: 1, g: 1, b: 1 }),
    new AuraClient().setColor({ r: 1, g: 1, b: 1 }),
    new GamesenseClient().setColor({ r: 1, g: 1, b: 1 }),
    new MysticLightClient().setColor({ r: 1, g: 1, b: 1 }),
  ]);
  check(
    "every vendor client refuses a color push before connecting, rather than crashing",
    results.every((r) => r.ok === false && typeof r.message === "string")
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_VENDOR_MODULE_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_VENDOR_MODULE_CHECKS_PASSED");
