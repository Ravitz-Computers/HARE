// System sensors — the reading pipeline, and the discipline around it.
//
// WHAT CAN AND CANNOT BE TESTED HERE
//
// There is no Windows, no NVIDIA GPU, no AMD GPU and no AIO in this
// environment, so nothing here proves HARE reads a real sensor correctly.
// What it does prove is everything up to the hardware:
//
//   - the unit conversions, which are the single most likely thing to be
//     silently wrong (milliwatts read as watts, millidegrees as degrees,
//     two bytes assembled in the wrong order),
//   - the parsers for the two bridged sources, driven by real output shapes,
//   - the plausibility checks that turn a misread offset into "no reading"
//     rather than a confident wrong number,
//   - and the hub's resource discipline: nothing polls while nothing is
//     watching, one failing source can't take the snapshot down, and a
//     slow source can't stack up overlapping polls.
//
// The last one matters most. A sensor layer that keeps polling after the
// window closes is exactly the kind of background cost HARE exists not to
// have.
import {
  sampleCpuTimes,
  cpuLoadBetween,
  SystemLoadProvider,
} from "../dist-electron/backend/sensors/providers/systemLoad.js";
import { milliwattsToWatts, readCString } from "../dist-electron/backend/sensors/providers/nvidiaGpu.js";
import {
  milliDegreesToCelsius,
  isPlausibleGpuTemperature,
} from "../dist-electron/backend/sensors/providers/amdGpu.js";
import { parseKrakenStatus } from "../dist-electron/backend/sensors/providers/coolerStatus.js";
import {
  parseLibreHardwareMonitorJson,
  buildPollScript,
  LibreHardwareMonitorProvider,
} from "../dist-electron/backend/sensors/providers/libreHardwareMonitor.js";
import { parseHwinfoRegistry, HwinfoProvider } from "../dist-electron/backend/sensors/providers/hwinfoRegistry.js";
import { SensorHub } from "../dist-electron/backend/sensors/sensorHub.js";
import { createClaimCounter } from "../dist-electron/backend/sensors/sensorClaims.js";
import { hottestTemperature, formatReading } from "../dist-electron/backend/sensors/sensorTypes.js";
import { parseServiceState, detectPawnIo } from "../dist-electron/backend/pawnIo.js";
import { thermalLevel, computeEffectFrame, reportHottestTemperature } from "../dist-electron/backend/effectsEngine.js";
import { EFFECTS } from "../dist-electron/backend/types.js";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("System sensors...\n");

// --- Unit conversions -------------------------------------------------------
{
  check("NVML power is converted from milliwatts", milliwattsToWatts(185_000) === 185);
  check("...including fractional watts", milliwattsToWatts(41_500) === 41.5);
  check("ADL temperature is converted from millidegrees", milliDegreesToCelsius(52_000) === 52);
  check("...and keeps one decimal", milliDegreesToCelsius(64_300) === 64.3);
  check(
    "a raw millidegree value would be rejected as implausible",
    !isPlausibleGpuTemperature(52_000) && isPlausibleGpuTemperature(52)
  );
  check("a zero temperature is treated as no reading, not as freezing", !isPlausibleGpuTemperature(0));
  check("a NUL-terminated C string is trimmed at the terminator", readCString(new Uint8Array([71, 80, 85, 0, 88, 88])) === "GPU");
}

// --- CPU load is a difference, not a value ---------------------------------
{
  const first = { idle: 1000, total: 2000 };
  check("the first sample has nothing to compare against and reports 0", cpuLoadBetween(null, first) === 0);
  // Half the new ticks were idle → 50% busy.
  check("busy percentage comes from the delta", cpuLoadBetween(first, { idle: 1100, total: 2200 }) === 50);
  check("a fully idle interval reads 0", cpuLoadBetween(first, { idle: 1200, total: 2200 }) === 0);
  check("a fully busy interval reads 100", cpuLoadBetween(first, { idle: 1000, total: 2200 }) === 100);
  check(
    "counters that wrap or don't advance report 0 rather than dividing by zero",
    cpuLoadBetween(first, { idle: 1000, total: 2000 }) === 0 && cpuLoadBetween(first, { idle: 900, total: 1800 }) === 0
  );
  const sample = sampleCpuTimes([{ times: { user: 1, nice: 2, sys: 3, idle: 4, irq: 5 } }]);
  check("per-core tick counters are summed into one idle/total pair", sample.idle === 4 && sample.total === 15);
}

// --- The one source that works on every machine, including this one --------
{
  const provider = new SystemLoadProvider();
  const probe = await provider.probe();
  check("system load is always available", probe.available === true);
  await provider.read();
  await sleep(60);
  const readings = await provider.read();
  const cpu = readings.find((r) => r.id === "system:cpu-load");
  const memory = readings.find((r) => r.id === "system:memory-load");
  check("it reports a CPU load in range", !!cpu && cpu.value >= 0 && cpu.value <= 100);
  check("it reports a memory load in range", !!memory && memory.value > 0 && memory.value <= 100);
  check("memory used is a sane number of gigabytes", readings.some((r) => r.unit === "GB" && r.value > 0));
}

// --- Kraken status bytes ----------------------------------------------------
{
  const msg = new Array(64).fill(0);
  msg[0] = 0x75;
  msg[1] = 0x01;
  msg[15] = 31; // whole degrees
  msg[16] = 4; //  tenths
  msg[17] = 0x60; // pump rpm, low byte
  msg[18] = 0x07; // pump rpm, high byte
  msg[23] = 0x20;
  msg[24] = 0x03;
  const status = parseKrakenStatus(msg);
  check("liquid temperature combines whole degrees and tenths", status.liquidCelsius === 31.4);
  check("pump RPM is assembled little-endian", status.pumpRpm === 0x0760);
  check("fan RPM is assembled little-endian", status.fanRpm === 0x0320);

  const nonsense = new Array(64).fill(0xff);
  const bad = parseKrakenStatus(nonsense);
  check(
    "an all-ones report is rejected rather than reported as a hot cooler",
    bad.liquidCelsius === null && bad.pumpRpm === null && bad.fanRpm === null
  );
  const empty = parseKrakenStatus([]);
  check("a truncated report doesn't throw", empty.liquidCelsius === null);
  const stopped = new Array(64).fill(0);
  stopped[15] = 28;
  check("a stopped fan reports 0, not 'no reading'", parseKrakenStatus(stopped).fanRpm === 0);
}

// --- LibreHardwareMonitor bridge -------------------------------------------
{
  const many = JSON.stringify([
    { Identifier: "/amdcpu/0/temperature/2", Name: "Core (Tctl/Tdie)", SensorType: "Temperature", Value: 61.5 },
    { Identifier: "/lpc/nct6797d/fan/1", Name: "Fan #2", SensorType: "Fan", Value: 843 },
    { Identifier: "/amdcpu/0/load/0", Name: "CPU Total", SensorType: "Load", Value: 12.25 },
    { Identifier: "/amdcpu/0/power/0", Name: "Package", SensorType: "Power", Value: 88 },
    { Identifier: "/amdcpu/0/voltage/0", Name: "Core VID", SensorType: "Voltage", Value: 1.1 },
    { Identifier: "/nvme/0/temperature/0", Name: "Drive", SensorType: "Temperature", Value: null },
  ]);
  const readings = parseLibreHardwareMonitorJson(many);
  check("temperatures, fans, loads and power are picked up", readings.length === 4);
  check("units follow the sensor type", readings.find((r) => r.kind === "fan").unit === "RPM");
  check("sensor types HARE doesn't display are skipped", !readings.some((r) => r.label === "Core VID"));
  check(
    "a sensor with no value yet is skipped rather than reported as 0",
    !readings.some((r) => r.label === "Drive")
  );
  check("readings are tagged with their source", readings.every((r) => r.source === "libre-hardware-monitor"));

  // PowerShell's ConvertTo-Json emits a bare object, not an array, when there
  // is exactly one row — the case that breaks a naive parser on a machine
  // with a single sensor.
  const one = parseLibreHardwareMonitorJson(
    JSON.stringify({ Identifier: "/gpu/0/temperature/0", Name: "GPU Core", SensorType: "Temperature", Value: 44 })
  );
  check("a single sensor arrives as a bare object and is still parsed", one.length === 1 && one[0].value === 44);
  check("a truncated or non-JSON line is ignored", parseLibreHardwareMonitorJson("{ partial").length === 0);

  const script = buildPollScript(2);
  check("the poll script reads the LibreHardwareMonitor namespace", script.includes("root/LibreHardwareMonitor"));
  check("...loops rather than being re-launched per poll", script.includes("while ($true)"));
  check("...and can't crash out on a transient WMI error", script.includes("catch"));
}

// --- The bridge holds exactly one process, and lets go of it ---------------
{
  const launches = [];
  class FakePowerShell extends EventEmitter {
    constructor() {
      super();
      this.stdout = new EventEmitter();
      this.stdout.setEncoding = () => {};
      this.killed = false;
    }
    kill() {
      this.killed = true;
    }
  }

  const provider = new LibreHardwareMonitorProvider(2, () => {
    const child = new FakePowerShell();
    launches.push(child);
    // Arrives in two chunks split mid-line, which is what a real sensor list does.
    setTimeout(() => {
      child.stdout.emit("data", '[{"Identifier":"/gpu/0/temperature/0","Name":"GPU Core","Sen');
      child.stdout.emit("data", 'sorType":"Temperature","Value":51}]\n');
    }, 20);
    return child;
  });

  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const probe = await provider.probe();
    check("the bridge reports available once real values arrive", probe.available === true);
    check("only one process is launched", launches.length === 1);
    const readings = await provider.read();
    check("a reading split across chunks is reassembled", readings.length === 1 && readings[0].value === 51);
    provider.dispose();
    check("disposing kills the process rather than leaving it running", launches[0].killed === true);
    check("...and drops the stale readings with it", (await provider.read()).length === 0);
  } finally {
    Object.defineProperty(process, "platform", realPlatform);
  }
}

// --- HWiNFO's free registry values -----------------------------------------
{
  const stdout = [
    "HKEY_CURRENT_USER\\Software\\HWiNFO64\\VSB",
    "    Sensor0    REG_SZ    CPU [#0]: AMD Ryzen 7 5800X",
    "    Label0    REG_SZ    CPU (Tctl/Tdie)",
    "    Value0    REG_SZ    58.4 °C",
    "    ValueRaw0    REG_SZ    58.375",
    "    Label1    REG_SZ    Total CPU Usage",
    "    Value1    REG_SZ    23 %",
    "    ValueRaw1    REG_SZ    23.000",
    "    Label2    REG_SZ    Chassis1 Fan",
    "    Value2    REG_SZ    912 RPM",
    "    ValueRaw2    REG_SZ    912.000",
    "    Label3    REG_SZ    Core Voltage",
    "    Value3    REG_SZ    1.325 V",
    "",
  ].join("\r\n");
  const readings = parseHwinfoRegistry(stdout);
  check("numbered label/value pairs are matched up", readings.length === 3);
  check("the unit in the value decides the kind", readings[0].kind === "temperature" && readings[2].kind === "fan");
  check("the raw value is preferred over the formatted one", readings[0].value === 58.375);
  check("a unit HARE has no use for is skipped", !readings.some((r) => r.label === "Core Voltage"));
  check("labels are the user's own from HWiNFO", readings[1].label === "Total CPU Usage");
  check("empty output produces no readings and no error", parseHwinfoRegistry("").length === 0);

  const comma = parseHwinfoRegistry(
    ["HKEY_CURRENT_USER\\Software\\HWiNFO64\\VSB", "    Label0    REG_SZ    CPU", "    Value0    REG_SZ    58,4 °C", ""].join("\r\n")
  );
  check("a comma decimal separator is handled when there's no raw value", comma[0]?.value === 58.4);

  const provider = new HwinfoProvider(async () => {
    throw new Error("The system was unable to find the specified registry key");
  });
  check("a missing registry key reads as no sensors, not as an error", (await provider.read()).length === 0);
}

// --- The hub: nothing runs while nothing is watching -----------------------
{
  let reads = 0;
  let disposals = 0;
  const provider = {
    id: "system",
    name: "Fake",
    async probe() {
      return { available: true, detail: "" };
    },
    async read() {
      reads++;
      return [{ id: "t", label: "CPU", kind: "temperature", value: 40 + reads, unit: "°C", source: "system" }];
    },
    dispose() {
      disposals++;
    },
  };

  const hub = new SensorHub([provider], 30);
  check("the hub is idle before anything watches", !hub.isRunning && reads === 0);

  const releaseA = hub.watch();
  await sleep(20);
  check("the first watcher starts it", hub.isRunning);
  check("...and it polls immediately rather than after one interval", reads >= 1);

  const releaseB = hub.watch();
  await sleep(80);
  const duringTwo = reads;
  releaseA();
  check("a second watcher doesn't start a second timer", hub.isRunning && hub.watcherCount === 1);

  releaseB();
  await sleep(60);
  check("the last watcher to leave stops it", !hub.isRunning);
  check("...and disposes what providers held open", disposals === 1);
  const afterStop = reads;
  await sleep(80);
  check("nothing is read once nobody is watching", reads === afterStop && reads >= duringTwo);

  // Releasing twice is easy to do from React's cleanup and must not
  // underflow the count into "permanently running".
  const release = hub.watch();
  release();
  release();
  await sleep(20);
  check("releasing the same watcher twice doesn't corrupt the count", hub.watcherCount === 0 && !hub.isRunning);
}

// --- One broken source must not take the snapshot down ---------------------
{
  const good = {
    id: "system",
    name: "Good",
    async probe() {
      return { available: true, detail: "fine" };
    },
    async read() {
      return [{ id: "g", label: "GPU", kind: "temperature", value: 55, unit: "°C", source: "system" }];
    },
  };
  const bad = {
    id: "nvidia",
    name: "Bad",
    async probe() {
      return { available: true, detail: "" };
    },
    async read() {
      throw new Error("the driver went away");
    },
  };

  const hub = new SensorHub([bad, good], 30);
  const release = hub.watch();
  await sleep(40);
  const snapshot = hub.getSnapshot();
  release();

  check("a throwing source doesn't stop the others reporting", snapshot.readings.some((r) => r.label === "GPU"));
  check("...and is marked unavailable with the reason", snapshot.sources.some((s) => s.id === "nvidia" && !s.available && s.detail.includes("went away")));
  check("the snapshot carries a timestamp once it has real data", typeof snapshot.updatedAt === "string");
}

// --- Overlapping sources: first one wins ------------------------------------
{
  const direct = {
    id: "nvidia",
    name: "Direct",
    async probe() {
      return { available: true, detail: "" };
    },
    async read() {
      return [{ id: "a", label: "GPU", kind: "temperature", value: 60, unit: "°C", source: "nvidia" }];
    },
  };
  const bridged = {
    id: "libre-hardware-monitor",
    name: "Bridged",
    async probe() {
      return { available: true, detail: "" };
    },
    async read() {
      return [
        { id: "b", label: "GPU", kind: "temperature", value: 61, unit: "°C", source: "libre-hardware-monitor" },
        { id: "c", label: "CPU", kind: "temperature", value: 70, unit: "°C", source: "libre-hardware-monitor" },
      ];
    },
  };

  const hub = new SensorHub([direct, bridged], 30);
  const release = hub.watch();
  await sleep(40);
  const snapshot = hub.getSnapshot();
  release();

  const gpus = snapshot.readings.filter((r) => r.label === "GPU");
  check("a sensor two sources both report appears once", gpus.length === 1);
  check("...from the source listed first", gpus[0].source === "nvidia");
  check("what only the second source has is still included", snapshot.readings.some((r) => r.label === "CPU"));
  check("the hottest reading is found across sources", hottestTemperature(snapshot).value === 70);
  check("readings format with the right precision", formatReading(gpus[0]) === "60.0 °C");
}

// --- The Thermal effect -----------------------------------------------------
{
  check("the Thermal effect is offered in the UI", EFFECTS.some((e) => e.id === "thermal"));
  check("no temperature reads as the bottom of the range", thermalLevel(null) === 0);
  check("an idle PC reads at the bottom", thermalLevel(20) === 0);
  check("a hot PC reads at the top", thermalLevel(95) === 1);
  check("halfway is halfway", Math.abs(thermalLevel(60) - 0.5) < 0.01);

  const assignment = {
    deviceId: 1,
    zoneId: null,
    effectId: "thermal",
    color: { r: 255, g: 255, b: 255 },
    speed: 50,
    brightness: 100,
  };

  reportHottestTemperature(30);
  const cold = computeEffectFrame(assignment, 4, 0);
  reportHottestTemperature(95);
  const hot = computeEffectFrame(assignment, 4, 0);

  check("every LED gets a colour", cold.length === 4 && hot.length === 4);
  check("a cold PC is blue", cold[0].b > cold[0].r);
  check("a hot PC is red", hot[0].r > hot[0].b);
  check(
    "channels stay in range",
    [...cold, ...hot].every((c) => [c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
  );

  reportHottestTemperature(60);
  const a = computeEffectFrame(assignment, 4, 1234);
  const b = computeEffectFrame(assignment, 4, 1234);
  check("the same inputs give the same frame", JSON.stringify(a) === JSON.stringify(b));

  // Nothing reporting must not leave the effect stuck at the last value it saw.
  reportHottestTemperature(null);
  const none = computeEffectFrame(assignment, 4, 0);
  check("with no sensors at all it falls back to the cold end", none[0].b > none[0].r);
}

// --- PawnIO detection -------------------------------------------------------
{
  const running = [
    "SERVICE_NAME: PawnIO",
    "        TYPE               : 1  KERNEL_DRIVER",
    "        STATE              : 4  RUNNING",
    "                                (STOPPABLE, NOT_PAUSABLE)",
  ].join("\r\n");
  const stopped = running.replace("4  RUNNING", "1  STOPPED");

  check("a running driver is recognised", parseServiceState(running).exists && parseServiceState(running).running);
  check("an installed but stopped driver is told apart", parseServiceState(stopped).exists && !parseServiceState(stopped).running);
  check(
    "'service does not exist' is not mistaken for installed",
    !parseServiceState("[SC] EnumQueryServicesStatus:OpenService FAILED 1060").exists
  );

  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const absent = await detectPawnIo(
      async () => {
        throw new Error("service does not exist");
      },
      () => false
    );
    check("nothing installed says what it would unlock", !absent.installed && /motherboard/i.test(absent.detail));

    const filesOnly = await detectPawnIo(
      async () => {
        throw new Error("nope");
      },
      (path) => path.includes("PawnIOLib.dll")
    );
    check("a driver on disk is found even if the service query fails", filesOnly.installed === true);

    const live = await detectPawnIo(async () => running, () => true);
    check("a running driver reports running", live.installed && live.running);

    const halted = await detectPawnIo(async () => stopped, () => true);
    check("a stopped driver says how to fix it", halted.installed && !halted.running && /restart/i.test(halted.detail));
  } finally {
    Object.defineProperty(process, "platform", realPlatform);
  }
}

// --- Several watchers in one window ---------------------------------------
//
// The main process tracks sensor watching per *window*: the first request
// takes a claim on the hub, later ones are ignored, and one release drops it.
// Four things in one window ask independently — the cooler-screen redraw
// loop, the Widgets & Screens panel, the sensor settings page and the
// dashboard's sensor widget.
//
// Without a count in front of that, opening the screen panel and leaving it
// again sent a release that dropped the claim the redraw loop was holding,
// and polling stopped. Nothing errored anywhere: the cooler carried on being
// redrawn from a snapshot that never changed, so every reading on it showed a
// dash until HARE was restarted. That is the failure these checks are for.
{
  const claims = createClaimCounter();

  check("the first watcher is the one the main process is told about", claims.change(true) === true);
  check("a second watcher in the same window is not", claims.change(true) === false);
  check("nor is a third", claims.change(true) === false);

  check("releasing one of three tells nobody", claims.change(false) === false);
  check("releasing the second still tells nobody", claims.change(false) === false);
  check("only the last release stops the hub", claims.change(false) === true);
  check("and the count is back to nothing", claims.count === 0);

  // The exact sequence from the bug: the screen readout starts watching, the
  // settings panel is opened and closed, and the readout must still be live.
  const live = createClaimCounter();
  live.change(true); // redraw loop mounts
  live.change(true); // panel opened
  check(
    "closing a panel does not stop sensors the screen readout is still using",
    live.change(false) === false && live.count === 1
  );

  // React re-runs effect cleanups in development, and a window reload starts
  // the renderer's count at zero while the main process still holds its claim.
  // A release with nothing held must not turn a source off underneath
  // whatever else is using it.
  const spurious = createClaimCounter();
  check("a release with nothing held is ignored", spurious.change(false) === false);
  check("and does not push the count below zero", spurious.count === 0);
  check("so the next real watcher still starts the hub", spurious.change(true) === true);
}

// --- And the store actually goes through it -------------------------------
//
// The counter passing its own checks proves nothing if the one caller that
// matters still talks to the main process on every mount and unmount.
{
  const store = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
  const action = store.slice(store.indexOf("watchSensors: async"), store.indexOf("refreshSensors: async"));
  check(
    "the store counts its claims before telling the main process",
    /sensorClaims\.change\(watching\)/.test(action)
  );
  check(
    "and returns early rather than sending anything on a middle claim",
    /if \(!sensorClaims\.change\(watching\)\) return;/.test(action)
  );
  check(
    "watchSensors reaches the main process from exactly one place",
    (action.match(/api\.watchSensors\(/g) ?? []).length === 1
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_SENSOR_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_SENSOR_CHECKS_PASSED");
process.exit(0);
