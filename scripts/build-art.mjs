// Every raster HARE ships, drawn from the vectors.
//
// WHY THIS EXISTS
//
// The icons used to be cut out of a flat character sheet with a flood-fill
// script. One of them came off that sheet 141 pixels wide and was quietly
// upscaled to 1024 for the app icon; nobody noticed until the packaged zip
// shrank by a megabyte and a half. Nothing here can go wrong that way -- every
// output is rendered from a vector at the size it's actually used, so the app
// icon is drawn at 1024 rather than blown up to it.
//
// Outputs (all into build/):
//   icon.png             1024x1024   the app icon electron-builder converts
//   icon.ico             multi-size  Windows executable + shortcut icon
//   trayTemplate.png     64x64       the system-tray icon
//   installerSidebar.bmp 164x314     NSIS welcome/finish page artwork
//   installerHeader.bmp  150x57      NSIS inner-page header
//
// The two BMPs are 24-bit with no alpha on purpose: NSIS renders a PNG, or a
// BMP with an alpha channel, as a black rectangle.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vectors = path.join(root, "src", "assets", "vinny");
const build = path.join(root, "build");
mkdirSync(build, { recursive: true });

/** Everything this script writes. Also the list of what has to exist to skip it. */
const OUTPUTS = [
  "icon.png",
  "icon.ico",
  "trayTemplate.png",
  "installerSidebar.bmp",
  "installerHeader.bmp",
  "dashboard-icon.ico",
];

/**
 * `sharp` is a native module, and this runs on every build.
 *
 * If it can't be loaded -- no prebuilt binary for this platform, a blocked
 * postinstall, a corporate proxy -- the artwork can't be redrawn. That must
 * not take the whole build down when the artwork is already sitting in
 * build/ and hasn't changed, because the alternative is that nobody can build
 * HARE at all over an icon that is already correct.
 *
 * But it also must not quietly ship stale artwork when there is none, so a
 * missing output is still a hard failure.
 */
let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch (err) {
  const missing = OUTPUTS.filter((name) => !existsSync(path.join(build, name)));
  if (missing.length === 0) {
    console.warn("");
    console.warn("  [!] Couldn't load `sharp`, so the artwork wasn't redrawn.");
    console.warn(`      ${err.message}`);
    console.warn("      Using the icons already in build/. If you changed a Vinny vector,");
    console.warn("      run `npm install` and then `npm run art` before shipping.");
    console.warn("");
    process.exit(0);
  }
  console.error("");
  console.error("Can't draw the artwork, and some of it doesn't exist yet:");
  for (const name of missing) console.error(`  missing  build/${name}`);
  console.error("");
  console.error(`\`sharp\` failed to load: ${err.message}`);
  console.error("Run `npm install` and try again.");
  process.exit(1);
}

/** The installer's own background, matching HARE's panels rather than plain white. */
const INK = { r: 15, g: 15, b: 20 };

/** Renders a vector into a transparent square of exactly `size`, centred. */
async function pose(name, size, variant = "light") {
  const file = path.join(vectors, variant, `${name}.svg`);
  // density scales the rasteriser's DPI so a large output is genuinely drawn
  // large rather than drawn small and enlarged.
  const art = await sharp(file, { density: Math.max(72, Math.round(size * 1.6)) })
    .resize(size, size, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toBuffer();
}

/**
 * Windows .ico, written by hand.
 *
 * It's a 6-byte header, a 16-byte directory entry per image and then the PNG
 * bytes -- small enough that writing it is less trouble than another
 * dependency, and it keeps every size a real render rather than a resample of
 * the largest one.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/** 24-bit BMP, bottom-up, 4-byte row padding -- the only thing NSIS reliably draws. */
function bmp24(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3;
    let dst = y * rowSize;
    for (let x = 0; x < width; x++) {
      pixels[dst++] = rgb[src + x * 3 + 2]; // B
      pixels[dst++] = rgb[src + x * 3 + 1]; // G
      pixels[dst++] = rgb[src + x * 3]; // R
    }
  }
  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([header, pixels]);
}

/**
 * Composites the layers onto an opaque ground and returns tightly packed RGB.
 *
 * `removeAlpha` is not optional here: compositing anything with transparency
 * promotes the pipeline to four channels, and four channels written into a
 * three-channel BMP is what turned the first pass of these panels into green
 * static.
 */
async function flatten(layers, width, height, background) {
  const { data, info } = await sharp({ create: { width, height, channels: 4, background: { ...background, alpha: 1 } } })
    .composite(layers)
    .flatten({ background })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Expected 3 channels for the BMP, got ${info.channels}.`);
  if (data.length !== width * height * 3) {
    throw new Error(`Expected ${width * height * 3} bytes, got ${data.length}.`);
  }
  return data;
}

/** A soft radial wash behind the artwork, so the panels aren't a flat rectangle. */
async function backdrop(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="g" cx="30%" cy="18%" r="95%">
        <stop offset="0%" stop-color="#2a1230"/>
        <stop offset="55%" stop-color="#141119"/>
        <stop offset="100%" stop-color="#0b0b0f"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  // --- The app icon ---------------------------------------------------------
  const appIcon = await pose("hare-logo-1", 1024);
  writeFileSync(path.join(build, "icon.png"), appIcon);

  const icoSizes = [256, 128, 64, 48, 32, 24, 16];
  const icoImages = [];
  for (const size of icoSizes) {
    icoImages.push({ size, data: await pose("hare-logo-1", size) });
  }
  writeFileSync(path.join(build, "icon.ico"), ico(icoImages));

  // --- The second screen's own icon -----------------------------------------
  // The dashboard window gets its own taskbar button, so it needs its own
  // icon: sharing HARE's meant two identical buttons, one of which is a
  // frameless fullscreen window and reads as a stray dialog. A different
  // badge makes the two tellable apart at a glance on the taskbar.
  const dashboardIco = [];
  for (const size of [256, 64, 48, 32, 24, 16]) {
    dashboardIco.push({ size, data: await pose("hare-logo-2", size) });
  }
  writeFileSync(path.join(build, "dashboard-icon.ico"), ico(dashboardIco));

  // --- The tray icon --------------------------------------------------------
  // The dark-outlined silhouette, which is what reads at tray size against
  // both a light and a dark Windows taskbar.
  writeFileSync(path.join(build, "trayTemplate.png"), await pose("hare-taskbar-icon", 64));

  // --- Installer artwork ----------------------------------------------------
  const sidebarW = 164;
  const sidebarH = 314;
  const sidebarArt = await pose("hello", 150, "dark");
  const sidebarRgb = await flatten(
    [
      { input: await backdrop(sidebarW, sidebarH), top: 0, left: 0 },
      { input: sidebarArt, top: 84, left: 7 },
    ],
    sidebarW,
    sidebarH,
    INK
  );
  writeFileSync(path.join(build, "installerSidebar.bmp"), bmp24(sidebarRgb, sidebarW, sidebarH));

  const headerW = 150;
  const headerH = 57;
  const headerArt = await pose("hare-logo-1", 45, "dark");
  const headerRgb = await flatten(
    [
      { input: await backdrop(headerW, headerH), top: 0, left: 0 },
      { input: headerArt, top: 6, left: 99 },
    ],
    headerW,
    headerH,
    INK
  );
  writeFileSync(path.join(build, "installerHeader.bmp"), bmp24(headerRgb, headerW, headerH));

  console.log(
    `Wrote build/icon.png (1024), build/icon.ico (${icoSizes.join("/")}), build/dashboard-icon.ico, ` +
      `build/trayTemplate.png (64), ` +
      `build/installerSidebar.bmp (${sidebarW}x${sidebarH}), build/installerHeader.bmp (${headerW}x${headerH}).`
  );
}

main().catch((err) => {
  console.error("Couldn't build the artwork:", err);
  process.exit(1);
});
