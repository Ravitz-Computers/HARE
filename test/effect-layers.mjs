// Verification for layer compositing and sequencing
// (computeLayeredFrame / computeAssignmentFrame in effectsEngine.ts).
//
// Layering is the one part of the effect system where a bug is easy to ship
// and hard to notice: a stack still renders *something*, so a wrong blend or
// a broken window just looks like a slightly different look rather than an
// obvious failure. These checks pin down the properties that make a stack
// predictable.
import { computeEffectFrame, computeLayeredFrame, computeAssignmentFrame } from "../dist-electron/backend/effectsEngine.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const BASE = { deviceId: 0, zoneId: null };
const LEDS = 16;

function layer(over = {}) {
  return {
    id: "l" + Math.abs(JSON.stringify(over).length),
    effectId: "static",
    color: { r: 100, g: 50, b: 20 },
    speed: 50,
    brightness: 100,
    opacity: 100,
    blendMode: "normal",
    enabled: true,
    ...over,
  };
}

const inRange = (frame) =>
  frame.every((c) => [c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255));

console.log("Effect layer compositing...");

// --- A single Normal layer at full opacity == that effect on its own -------
// This is the property that keeps layered and unlayered looks consistent:
// adding a layer stack around one effect must not subtly change it.
for (const effectId of ["rainbow-wave", "comet", "fire", "gradient", "twinkle"]) {
  const single = computeEffectFrame(
    { ...BASE, effectId, color: { r: 200, g: 30, b: 90 }, speed: 45, brightness: 100 },
    LEDS,
    2500
  );
  const stacked = computeLayeredFrame(
    { layers: [layer({ effectId, color: { r: 200, g: 30, b: 90 }, speed: 45 })] },
    BASE,
    LEDS,
    2500
  );
  check(
    `one Normal layer at 100% renders identically to "${effectId}" alone`,
    JSON.stringify(single) === JSON.stringify(stacked)
  );
}

// --- Empty and all-disabled stacks are black, not undefined ----------------
const empty = computeLayeredFrame({ layers: [] }, BASE, LEDS, 1000);
check(
  "an empty stack renders black rather than throwing or returning holes",
  empty.length === LEDS && empty.every((c) => c.r === 0 && c.g === 0 && c.b === 0)
);
const allOff = computeLayeredFrame({ layers: [layer({ enabled: false })] }, BASE, LEDS, 1000);
check("a stack with every layer disabled renders black", allOff.every((c) => c.r === 0 && c.g === 0));

// --- Opacity actually attenuates -------------------------------------------
const full = computeLayeredFrame({ layers: [layer({ opacity: 100 })] }, BASE, LEDS, 0);
const half = computeLayeredFrame({ layers: [layer({ opacity: 50 })] }, BASE, LEDS, 0);
const none = computeLayeredFrame({ layers: [layer({ opacity: 0 })] }, BASE, LEDS, 0);
check("opacity 100 shows the layer at full strength", full[0].r === 100);
check(`opacity 50 renders about half (got r=${half[0].r})`, half[0].r > 40 && half[0].r < 60);
check("opacity 0 contributes nothing", none[0].r === 0 && none[0].g === 0 && none[0].b === 0);

// --- Blend modes behave like their names ----------------------------------
const under = layer({ color: { r: 100, g: 100, b: 100 } });
const overWith = (blendMode, color) => layer({ blendMode, color });

const added = computeLayeredFrame(
  { layers: [under, overWith("add", { r: 100, g: 0, b: 0 })] },
  BASE,
  LEDS,
  0
);
check(`Add brightens the layer below (100 + 100 = ${added[0].r})`, added[0].r === 200);

const multiplied = computeLayeredFrame(
  { layers: [under, overWith("multiply", { r: 128, g: 255, b: 255 })] },
  BASE,
  LEDS,
  0
);
check(`Multiply darkens (100 x 128/255 = ${multiplied[0].r})`, multiplied[0].r > 45 && multiplied[0].r < 55);

const lightened = computeLayeredFrame(
  { layers: [under, overWith("lighten", { r: 40, g: 200, b: 40 })] },
  BASE,
  LEDS,
  0
);
check(
  `Lighten keeps the brighter channel of each (r=${lightened[0].r}, g=${lightened[0].g})`,
  lightened[0].r === 100 && lightened[0].g === 200
);

const screened = computeLayeredFrame(
  { layers: [under, overWith("screen", { r: 100, g: 0, b: 0 })] },
  BASE,
  LEDS,
  0
);
check(
  `Screen brightens without clipping (${screened[0].r}, between add and normal)`,
  screened[0].r > 100 && screened[0].r < 200
);

// --- Add saturates instead of wrapping -------------------------------------
// A channel wrapping past 255 would show up as a sudden dark flash on real
// hardware, which is exactly the kind of bug that's hard to trace back.
const blown = computeLayeredFrame(
  {
    layers: [
      layer({ color: { r: 255, g: 255, b: 255 } }),
      overWith("add", { r: 255, g: 255, b: 255 }),
      overWith("add", { r: 255, g: 255, b: 255 }),
    ],
  },
  BASE,
  LEDS,
  0
);
check("stacked Add layers clamp at 255 rather than wrapping to black", blown.every((c) => c.r === 255));

// --- Every blend mode stays in range across time ---------------------------
let allInRange = true;
for (const blendMode of ["normal", "add", "screen", "multiply", "lighten"]) {
  for (const ms of [0, 250, 1500, 9000]) {
    const frame = computeLayeredFrame(
      {
        layers: [
          layer({ effectId: "rainbow-wave" }),
          layer({ effectId: "comet", blendMode, opacity: 65 }),
          layer({ effectId: "twinkle", blendMode, opacity: 30 }),
        ],
      },
      BASE,
      LEDS,
      ms
    );
    if (frame.length !== LEDS || !inRange(frame)) allInRange = false;
  }
}
check("every blend mode keeps all channels integer and 0-255 over time", allInRange);

// --- Order matters, and matches "bottom first" -----------------------------
const redOverBlue = computeLayeredFrame(
  { layers: [layer({ color: { r: 0, g: 0, b: 255 } }), layer({ color: { r: 255, g: 0, b: 0 } })] },
  BASE,
  LEDS,
  0
);
check(
  "the last layer in the array is composited on top (bottom-first ordering)",
  redOverBlue[0].r === 255 && redOverBlue[0].b === 0
);

// --- Sequencing windows ----------------------------------------------------
// A 10s loop with two layers splitting it in half, no fade: each should own
// its half outright.
const seq = {
  loopSeconds: 10,
  layers: [
    layer({ color: { r: 255, g: 0, b: 0 }, window: { fromPct: 0, toPct: 50, fadePct: 0 } }),
    layer({ color: { r: 0, g: 0, b: 255 }, window: { fromPct: 50, toPct: 100, fadePct: 0 } }),
  ],
};
const at2s = computeLayeredFrame(seq, BASE, LEDS, 2000);
const at7s = computeLayeredFrame(seq, BASE, LEDS, 7000);
check("first half of the loop shows only the first layer", at2s[0].r === 255 && at2s[0].b === 0);
check("second half of the loop shows only the second layer", at7s[0].b === 255 && at7s[0].r === 0);

// The loop repeats rather than running once and stopping.
const at12s = computeLayeredFrame(seq, BASE, LEDS, 12000);
check("the sequence loops (t=12s matches t=2s)", JSON.stringify(at12s) === JSON.stringify(at2s));

// A window that wraps past the end of the loop stays continuous across the seam.
const wrapped = {
  loopSeconds: 10,
  layers: [layer({ color: { r: 255, g: 0, b: 0 }, window: { fromPct: 80, toPct: 20, fadePct: 0 } })],
};
check("a wrapped window is on before the loop end", computeLayeredFrame(wrapped, BASE, LEDS, 9000)[0].r === 255);
check("a wrapped window is still on after the loop end", computeLayeredFrame(wrapped, BASE, LEDS, 1000)[0].r === 255);
check("a wrapped window is off in the middle", computeLayeredFrame(wrapped, BASE, LEDS, 5000)[0].r === 0);

// Fades ramp rather than snapping.
const faded = {
  loopSeconds: 10,
  layers: [layer({ color: { r: 255, g: 0, b: 0 }, window: { fromPct: 0, toPct: 100, fadePct: 20 } })],
};
const rampStart = computeLayeredFrame(faded, BASE, LEDS, 500)[0].r;
const rampMid = computeLayeredFrame(faded, BASE, LEDS, 5000)[0].r;
check(
  `fadePct ramps the layer in (t=0.5s -> ${rampStart}, t=5s -> ${rampMid})`,
  rampStart > 0 && rampStart < rampMid && rampMid === 255
);

// Windows are ignored entirely when the look has no loop — otherwise a stack
// built with sequencing on would go dark the moment sequencing was turned off.
const noLoop = computeLayeredFrame(
  { layers: [layer({ color: { r: 255, g: 0, b: 0 }, window: { fromPct: 0, toPct: 10, fadePct: 0 } })] },
  BASE,
  LEDS,
  50000
);
check("windows are ignored when loopSeconds is unset, so no layer silently vanishes", noLoop[0].r === 255);

// --- computeAssignmentFrame dispatches correctly ---------------------------
const plain = { ...BASE, effectId: "comet", color: { r: 10, g: 200, b: 30 }, speed: 40, brightness: 100 };
check(
  "computeAssignmentFrame renders a plain assignment exactly like computeEffectFrame",
  JSON.stringify(computeAssignmentFrame(plain, LEDS, 800)) ===
    JSON.stringify(computeEffectFrame(plain, LEDS, 800))
);
check(
  "computeAssignmentFrame renders the stack when layers are present",
  JSON.stringify(computeAssignmentFrame({ ...plain, layers: [layer({ color: { r: 1, g: 2, b: 3 } })] }, LEDS, 800)) ===
    JSON.stringify(computeLayeredFrame({ layers: [layer({ color: { r: 1, g: 2, b: 3 } })] }, BASE, LEDS, 800))
);
check(
  "an empty layers array falls back to the single effect rather than rendering black",
  JSON.stringify(computeAssignmentFrame({ ...plain, layers: [] }, LEDS, 800)) ===
    JSON.stringify(computeEffectFrame(plain, LEDS, 800))
);

// --- Determinism holds for stacks too --------------------------------------
const stack = {
  loopSeconds: 8,
  layers: [
    layer({ effectId: "fire" }),
    layer({ effectId: "twinkle", blendMode: "add", opacity: 60, window: { fromPct: 25, toPct: 75, fadePct: 10 } }),
  ],
};
check(
  "identical inputs produce identical composited frames",
  JSON.stringify(computeLayeredFrame(stack, BASE, LEDS, 3333)) ===
    JSON.stringify(computeLayeredFrame(stack, BASE, LEDS, 3333))
);

// --- Degenerate LED counts -------------------------------------------------
check("a 0-LED stack returns an empty frame", computeLayeredFrame(stack, BASE, 0, 100).length === 0);
check("a 1-LED stack returns one valid color", inRange(computeLayeredFrame(stack, BASE, 1, 100)));

console.log("");
if (failures > 0) {
  console.error(`ALL_LAYER_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_LAYER_CHECKS_PASSED");
