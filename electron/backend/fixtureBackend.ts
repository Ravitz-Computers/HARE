import type { DeviceBackend } from "./deviceBackend.js";
import type { KLColor, KLDevice, BackendStatus, ModeParamsPatch } from "./types.js";

/**
 * A 5x15 grid with 7 gaps (68 real keys, not 75) — a real 65%-keyboard-shaped
 * matrix, gaps included, so the LED painter's gap handling has something
 * real to render in the dev preview instead of only ever seeing a full
 * rectangle.
 */
function keyboardMatrixKeys(): (number | undefined)[][] {
  const rows = 5;
  const cols = 15;
  const gapCells = new Set(["4-10", "4-11", "4-12", "4-13", "4-14", "0-14", "1-14"]);
  const keys: (number | undefined)[][] = [];
  let next = 0;
  for (let r = 0; r < rows; r++) {
    const row: (number | undefined)[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(gapCells.has(`${r}-${c}`) ? undefined : next++);
    }
    keys.push(row);
  }
  return keys;
}

/**
 * Sample devices for two things ONLY: `src/lib/browserBackend.ts` (the
 * plain-browser dev preview used by `npm run dev` and screenshots — never
 * reachable in the packaged Electron app, since window.hare always exists
 * there) and the automated test suite (test/smoke-live-effects.mjs). The real
 * app's BackendManager never constructs a FixtureBackend and has no code
 * path that could — HARE has exactly one device source (real OpenRGB
 * hardware); see noDeviceBackend.ts for what BackendManager actually shows
 * when there's nothing real to report.
 *
 * Every mode's flagList/direction/colorMode/colors/colorMin/colorMax below
 * is deliberately varied across devices — Direct mode is always
 * per-LED-color + manual save (matching what OpenRGB reports for a real
 * custom/direct mode), while the named native modes mix speed, direction,
 * brightness, and mode-specific colors so Advanced Mode's UI has real
 * variety to exercise in the browser dev preview instead of one flat shape.
 */
function sampleDevices(): KLDevice[] {
  return [
    {
      id: 0,
      name: "Aetherboard X570 Motherboard",
      vendor: "Sample Vendor",
      type: "motherboard",
      zones: [{ id: 0, name: "VRM Strip", ledStart: 0, ledCount: 12, matrix: null, type: 1, ledsMin: 12, ledsMax: 12, resizable: false }],
      leds: Array.from({ length: 12 }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Rainbow",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 50,
          flagList: ["speed", "directionLR", "direction", "brightness", "automaticSave"],
          direction: 0,
          colorMode: 0,
          colors: [],
          colorMin: 0,
          colorMax: 0,
          brightnessMin: 0,
          brightnessMax: 100,
          brightness: 100,
        },
        {
          id: 2,
          name: "Static",
          supportsDirectColor: false,
          flagList: ["modeSpecificColor", "brightness", "manualSave"],
          direction: 0,
          colorMode: 2,
          colors: [{ r: 255, g: 46, b: 122 }],
          colorMin: 1,
          colorMax: 1,
          brightnessMin: 0,
          brightnessMax: 100,
          brightness: 100,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 12 }, () => ({ r: 255, g: 46, b: 122 })),
      activeEffectId: "static",
    },
    {
      id: 1,
      name: "Ironclad 65% Mechanical Keyboard",
      vendor: "Sample Vendor",
      type: "keyboard",
      zones: [
        {
          id: 0,
          name: "Full Keyboard",
          ledStart: 0,
          ledCount: 68,
          matrix: { rows: 5, cols: 15, keys: keyboardMatrixKeys() },
          type: 2,
          ledsMin: 68,
          ledsMax: 68,
          resizable: false,
        },
      ],
      leds: Array.from({ length: 68 }, (_, i) => ({ id: i, name: `Key ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Wave",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 60,
          flagList: ["speed", "directionLR", "directionUD", "direction", "randomColor", "automaticSave"],
          direction: 1,
          colorMode: 3,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 68 }, () => ({ r: 139, g: 63, b: 251 })),
      activeEffectId: "rainbow-wave",
    },
    {
      id: 2,
      name: "Skirmish Wireless Mouse",
      vendor: "Sample Vendor",
      type: "mouse",
      zones: [{ id: 0, name: "Logo + Scroll", ledStart: 0, ledCount: 2, matrix: null, type: 1, ledsMin: 2, ledsMax: 2, resizable: false }],
      leds: [
        { id: 0, name: "Logo" },
        { id: 1, name: "Scroll Wheel" },
      ],
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Breathing",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 40,
          flagList: ["speed", "modeSpecificColor", "brightness", "manualSave"],
          direction: 0,
          colorMode: 2,
          colors: [{ r: 255, g: 77, b: 109 }],
          colorMin: 1,
          colorMax: 1,
          brightnessMin: 0,
          brightnessMax: 100,
          brightness: 80,
        },
      ],
      activeModeId: 0,
      colors: [
        { r: 255, g: 77, b: 109 },
        { r: 255, g: 77, b: 109 },
      ],
      activeEffectId: "breathing",
    },
    {
      id: 3,
      name: "Frostline 240 AIO Cooler",
      vendor: "Sample Vendor",
      type: "cooler",
      zones: [{ id: 0, name: "Pump Ring", ledStart: 0, ledCount: 16, matrix: null, type: 1, ledsMin: 16, ledsMax: 16, resizable: false }],
      leds: Array.from({ length: 16 }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Spectrum",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 50,
          flagList: ["speed", "randomColor", "automaticSave"],
          direction: 0,
          colorMode: 3,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 16 }, () => ({ r: 34, g: 211, b: 238 })),
      activeEffectId: "spectrum-cycle",
    },
    {
      // A standalone USB fan hub — OpenRGB reports controllers like this
      // (Corsair Commander/Lighting Node, NZXT RGB Controller, etc.) as
      // "led-strip" or "unknown", never a dedicated "fan" type, since the
      // protocol has none — see deviceClassification.ts's name-based
      // fan-controller heuristic, which this sample is here to exercise.
      id: 4,
      name: "Vanguard RGB Fan Hub (3-Fan)",
      vendor: "Sample Vendor",
      type: "led-strip",
      zones: [
        { id: 0, name: "Fan 1", ledStart: 0, ledCount: 8, matrix: null, type: 1, ledsMin: 8, ledsMax: 8, resizable: false },
        { id: 1, name: "Fan 2", ledStart: 8, ledCount: 8, matrix: null, type: 1, ledsMin: 8, ledsMax: 8, resizable: false },
        { id: 2, name: "Fan 3", ledStart: 16, ledCount: 8, matrix: null, type: 1, ledsMin: 8, ledsMax: 8, resizable: false },
      ],
      leds: Array.from({ length: 24 }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Rainbow",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 55,
          flagList: ["speed", "directionHV", "direction", "automaticSave"],
          direction: 4,
          colorMode: 0,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 24 }, () => ({ r: 61, g: 220, b: 151 })),
      activeEffectId: "static",
    },
    // Two sticks of the same kit, so the Dashboard's RAM-kit grouping (see
    // deviceClassification.ts's groupRamKits) has something real to show.
    {
      id: 5,
      name: "Specter DDR5-6000 RAM",
      vendor: "Sample Vendor",
      type: "ram",
      zones: [{ id: 0, name: "RAM Stick", ledStart: 0, ledCount: 8, matrix: null, type: 1, ledsMin: 8, ledsMax: 8, resizable: false }],
      leds: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Breathing",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 45,
          flagList: ["speed", "modeSpecificColor", "manualSave"],
          direction: 0,
          colorMode: 2,
          colors: [{ r: 255, g: 46, b: 122 }],
          colorMin: 1,
          colorMax: 1,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 8 }, () => ({ r: 255, g: 46, b: 122 })),
      activeEffectId: null,
    },
    {
      id: 6,
      name: "Specter DDR5-6000 RAM",
      vendor: "Sample Vendor",
      type: "ram",
      zones: [{ id: 0, name: "RAM Stick", ledStart: 0, ledCount: 8, matrix: null, type: 1, ledsMin: 8, ledsMax: 8, resizable: false }],
      leds: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Breathing",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 45,
          flagList: ["speed", "modeSpecificColor", "manualSave"],
          direction: 0,
          colorMode: 2,
          colors: [{ r: 139, g: 63, b: 251 }],
          colorMin: 1,
          colorMax: 1,
        },
      ],
      activeModeId: 0,
      colors: Array.from({ length: 8 }, () => ({ r: 139, g: 63, b: 251 })),
      activeEffectId: null,
    },
    {
      id: 7,
      name: "Aviator Wireless Headset",
      vendor: "Sample Vendor",
      type: "headset",
      zones: [{ id: 0, name: "Ear Cup Rings", ledStart: 0, ledCount: 2, matrix: null, type: 1, ledsMin: 2, ledsMax: 2, resizable: false }],
      leds: [
        { id: 0, name: "Left Cup" },
        { id: 1, name: "Right Cup" },
      ],
      modes: [
        {
          id: 0,
          name: "Direct",
          supportsDirectColor: true,
          flagList: ["perLedColor", "manualSave"],
          direction: 0,
          colorMode: 1,
          colors: [],
          colorMin: 0,
          colorMax: 0,
        },
        {
          id: 1,
          name: "Breathing",
          supportsDirectColor: false,
          minSpeed: 0,
          maxSpeed: 100,
          speed: 40,
          flagList: ["speed", "modeSpecificColor", "manualSave"],
          direction: 0,
          colorMode: 2,
          colors: [{ r: 34, g: 211, b: 238 }],
          colorMin: 1,
          colorMax: 1,
        },
      ],
      activeModeId: 0,
      colors: [
        { r: 34, g: 211, b: 238 },
        { r: 34, g: 211, b: 238 },
      ],
      activeEffectId: null,
    },
  ];
}

export class FixtureBackend implements DeviceBackend {
  readonly kind = "fixture" as const;
  private devices: KLDevice[] = sampleDevices();
  private status: BackendStatus = "connected";
  private statusMessage: string | undefined;
  private deviceListeners = new Set<(devices: KLDevice[]) => void>();
  private statusListeners = new Set<(status: BackendStatus, message?: string) => void>();

  constructor(private label = "Showing sample devices (dev/test preview only)") {
    this.statusMessage = label;
  }

  async connect(): Promise<void> {
    this.setStatus("connected", this.label);
    this.emitDevices();
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
  }

  async rescan(): Promise<void> {
    this.setStatus("scanning", "Refreshing sample devices…");
    await new Promise((r) => setTimeout(r, 400));
    this.devices = sampleDevices();
    this.setStatus("connected", this.label);
    this.emitDevices();
  }

  getStatus(): BackendStatus {
    return this.status;
  }

  getStatusMessage(): string | undefined {
    return this.statusMessage;
  }

  getDevices(): KLDevice[] {
    return this.devices;
  }

  async setDeviceColor(deviceId: number, color: KLColor): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    device.colors = device.colors.map(() => color);
    this.emitDevices();
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    const zone = device?.zones.find((z) => z.id === zoneId);
    if (!device || !zone) return;
    for (let i = zone.ledStart; i < zone.ledStart + zone.ledCount; i++) {
      device.colors[i] = color;
    }
    this.emitDevices();
  }

  async setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    if (zoneId === null) {
      device.colors = colors;
    } else {
      const zone = device.zones.find((z) => z.id === zoneId);
      if (!zone) return;
      for (let i = 0; i < colors.length && i < zone.ledCount; i++) {
        device.colors[zone.ledStart + i] = colors[i];
      }
    }
    // Emitted at effect-runner frame rate (~30fps) so device cards and
    // previews animate live. Fine at consumer device counts; if this ever
    // needs to scale to huge LED counts, throttle here.
    this.emitDevices();
  }

  async setNativeMode(deviceId: number, modeId: number): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    device.activeModeId = modeId;
    device.activeEffectId = null;
    this.emitDevices();
  }

  /** Dev-preview stand-in: applies the patch straight to the in-memory sample mode, exactly like a real device would report it back on the next refresh. */
  async updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, _persist: boolean): Promise<void> {
    const device = this.devices.find((d) => d.id === deviceId);
    const mode = device?.modes.find((m) => m.id === modeId);
    if (!device || !mode) return;
    if (patch.speed !== undefined) mode.speed = patch.speed;
    if (patch.brightness !== undefined) mode.brightness = patch.brightness;
    if (patch.direction !== undefined) mode.direction = patch.direction;
    if (patch.colorMode !== undefined) mode.colorMode = patch.colorMode;
    if (patch.colors !== undefined) mode.colors = patch.colors;
    this.emitDevices();
  }

  async setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void> {
    await this.setLedColors(deviceId, null, colors);
  }

  onDevicesChanged(cb: (devices: KLDevice[]) => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  onStatusChanged(cb: (status: BackendStatus, message?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(status: BackendStatus, message?: string) {
    this.status = status;
    this.statusMessage = message;
    this.statusListeners.forEach((cb) => cb(status, message));
  }

  private emitDevices() {
    this.deviceListeners.forEach((cb) => cb(this.devices));
  }
}
