// Regenerates THIRD-PARTY-NOTICES.md from what is *actually* installed.
//
// Run it with:  npm run notices
//
// Reproducing third-party copyright and permission notices is a condition of
// nearly every license HARE depends on (MIT, BSD and ISC all require it), so
// this file has to stay accurate as dependencies change. Hand-maintaining it
// guarantees it drifts, so it's generated: this walks the real production
// dependency tree (`npm ls --omit=dev`), reads each package's own license
// declaration and license file off disk, and emits the result verbatim.
//
// Dev-only dependencies are deliberately excluded — they build the app but
// are never distributed inside it, so their licenses impose no obligation on
// anyone who installs HARE.
//
// Things this cannot discover on its own, because they aren't npm packages,
// are listed in MANUAL_ENTRIES below — most importantly OpenRGB, which HARE
// redistributes as a bundled binary under the GPL-2.0. See LICENSE-NOTES.md.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Bundled components that are not npm packages, and so can't be discovered
 * from the dependency tree. Each still carries real obligations.
 */
const MANUAL_ENTRIES = [
  {
    name: "OpenRGB",
    version: "bundled portable Windows build (see vendor/openrgb/)",
    license: "GPL-2.0-only",
    homepage: "https://openrgb.org/",
    source: "https://gitlab.com/CalcProgrammer1/OpenRGB",
    copyright: "Copyright (c) Adam Honse and the OpenRGB contributors",
    note:
      "HARE redistributes an unmodified upstream OpenRGB binary and drives it as a separate " +
      "background process over its documented network SDK protocol. The full GPL-2.0 text is " +
      "included at licenses/GPL-2.0.txt, and complete corresponding source is available from the " +
      "project link above. See LICENSE-NOTES.md for the full explanation of this arrangement.",
  },
  {
    name: "Electron",
    version: "see devDependencies",
    license: "MIT",
    homepage: "https://www.electronjs.org/",
    copyright: "Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc.",
    note:
      "Electron embeds Chromium and Node.js, which carry their own additional third-party " +
      "licenses (BSD-3-Clause and others). Those notices ship inside the Electron runtime " +
      "distributed with HARE; the full set is published at " +
      "https://github.com/electron/electron/blob/main/LICENSE and in Chromium's own credits.",
  },
  {
    name: "PawnIO",
    version: "official signed installer, pinned by digest at build time (see scripts/pawnio-manifest.mjs)",
    license: "GPL-2.0",
    homepage: "https://pawnio.eu/",
    source: "https://github.com/namazso/PawnIO",
    copyright: "Copyright (c) namazso",
    note:
      "A signed kernel driver that OpenRGB uses from 1.0rc2 onward to reach the SMBus, which is " +
      "what motherboard and RAM lighting lives on. HARE redistributes the official installer " +
      "unmodified and runs it, visibly, only when the user asks — it never links against the " +
      "driver or calls it directly; OpenRGB does. The full GPL-2.0 text is included at " +
      "licenses/GPL-2.0.txt, and complete corresponding source is available from the project " +
      "link above and from https://github.com/namazso/PawnIO.Setup.",
  },
  {
    name: "hidapi",
    version: "vendored inside node-hid",
    license: "BSD-3-Clause (tri-licensed: GPL-3.0 / BSD-3-Clause / original HIDAPI license)",
    homepage: "https://github.com/libusb/hidapi",
    copyright: "Copyright (c) 2010, Alan Ott, Signal 11 Software",
    note:
      "HIDAPI lets its user pick one of three licenses. HARE uses it under the BSD-style " +
      "license, whose text ships at licenses/hidapi-BSD.txt.",
  },
];

/**
 * Software HARE talks to, is written from, or asks the user to install — but
 * never ships.
 *
 * None of these put a file in the installer, so none of them attaches a
 * redistribution obligation. They are listed because the honest question a
 * reader has is "what is this program actually made of", and an answer that
 * only covers what happens to be inside the zip is a poor one. One entry here
 * is also a genuine judgement call (liquidctl), and a judgement call that
 * isn't written down is one nobody can check.
 */
const RUNTIME_ENTRIES = [
  {
    name: "liquidctl",
    license: "GPL-3.0-or-later",
    homepage: "https://github.com/liquidctl/liquidctl",
    copyright: "Copyright (c) Jonas Malaco and the liquidctl contributors",
    note:
      "HARE's NZXT Kraken screen and status support was written from liquidctl's kraken3 " +
      "driver, which is the community reference for that protocol. No liquidctl code is " +
      "copied or shipped — what was taken is the protocol description: report ids, byte " +
      "offsets and message sequences, which are facts about the hardware rather than " +
      "expression. This is credited here because that reading is a judgement, the work is " +
      "genuinely owed to that project either way, and anyone auditing HARE should be able to " +
      "see where the protocol came from.",
  },
  {
    name: "NVIDIA Management Library (NVML)",
    license: "Proprietary — part of the NVIDIA display driver",
    homepage: "https://developer.nvidia.com/nvidia-management-library-nvml",
    note:
      "HARE reads GPU temperature, load, fan and power by calling nvml.dll, which the user's " +
      "own graphics driver installs. Nothing from NVIDIA is shipped, and the call signatures " +
      "were written from NVIDIA's public API documentation rather than from any header file.",
  },
  {
    name: "AMD Display Library (ADL)",
    license: "Proprietary — part of the AMD graphics driver",
    homepage: "https://gpuopen.com/adl/",
    note:
      "Same arrangement as NVML: HARE calls atiadlxx.dll from the user's own driver install " +
      "and ships nothing of AMD's.",
  },
  {
    name: "LibreHardwareMonitor",
    license: "MPL-2.0",
    homepage: "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor",
    note:
      "When the user already runs it, HARE reads the sensor values it publishes to a WMI " +
      "namespace. No LibreHardwareMonitor code is used, linked or shipped — this is one " +
      "program reading data another chose to publish. Credited because that data is what " +
      "gives HARE CPU and fan sensors at all.",
  },
  {
    name: "HWiNFO",
    license: "Proprietary — free for personal use",
    homepage: "https://www.hwinfo.com/",
    note:
      "HARE reads the gadget sensor values HWiNFO optionally writes to the registry. Nothing " +
      "of HWiNFO's is used or shipped, and HARE does not use its paid shared-memory interface.",
  },
];

function readLicenseText(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const match = entries.find((f) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(f));
  if (!match) return null;
  try {
    const full = path.join(dir, match);
    if (!fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, "utf8").trim();
  } catch {
    return null;
  }
}

/** Best-effort copyright line, for packages that declare a license but ship no license file. */
function guessCopyright(pkgJson, licenseText) {
  if (licenseText) {
    const line = licenseText.split(/\r?\n/).find((l) => /copyright/i.test(l));
    if (line) return line.trim();
  }
  const author = typeof pkgJson.author === "string" ? pkgJson.author : pkgJson.author?.name;
  return author ? `Copyright (c) ${author}` : null;
}

function collect() {
  const raw = execSync("npm ls --omit=dev --all --json", {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const tree = JSON.parse(raw);
  const found = new Map();

  (function walk(node) {
    for (const [name, info] of Object.entries(node.dependencies ?? {})) {
      if (!found.has(name)) found.set(name, info.version ?? "unknown");
      walk(info);
    }
  })(tree);

  const packages = [];
  for (const [name, version] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = path.join(root, "node_modules", name);
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      // An optionalDependency that didn't install on this platform. It isn't
      // present in node_modules, so it can't ship in a build made here.
      continue;
    }
    const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const licenseText = readLicenseText(dir);
    const declared =
      typeof pkgJson.license === "string"
        ? pkgJson.license
        : pkgJson.license?.type ??
          (Array.isArray(pkgJson.licenses) ? pkgJson.licenses.map((l) => l.type).join(" OR ") : null);
    packages.push({
      name,
      version,
      license: declared ?? (licenseText ? "see notice below" : "UNKNOWN"),
      homepage: pkgJson.homepage ?? pkgJson.repository?.url ?? null,
      copyright: guessCopyright(pkgJson, licenseText),
      licenseText,
    });
  }
  return packages;
}

function render(packages) {
  const lines = [];
  lines.push("# Third-Party Notices");
  lines.push("");
  lines.push(
    "HARE is built on open-source software. This file lists everything distributed as part of HARE, " +
      "along with its license and copyright notice, as those licenses require."
  );
  lines.push("");
  lines.push(
    "> This file is generated by `npm run notices` from the packages actually installed — " +
      "don't edit it by hand. Components that aren't npm packages (OpenRGB, Electron's embedded " +
      "Chromium, vendored C libraries) are listed first and maintained in `scripts/generate-notices.mjs`."
  );
  lines.push("");
  lines.push("HARE's own source code is licensed separately — see `LICENSE`.");
  lines.push("");
  lines.push("## Software HARE uses but does not ship");
  lines.push("");
  lines.push(
    "None of these are included in a HARE release. They are the programs HARE talks to, is " +
      "written from, or offers to install for you — listed so that what HARE is made of is " +
      "answerable without unzipping the installer."
  );
  lines.push("");
  for (const entry of RUNTIME_ENTRIES) {
    lines.push(`### ${entry.name}`);
    lines.push("");
    lines.push(`- **License:** ${entry.license}`);
    if (entry.copyright) lines.push(`- **Copyright:** ${entry.copyright}`);
    lines.push(`- **Home page:** ${entry.homepage}`);
    if (entry.source) lines.push(`- **Source:** ${entry.source}`);
    lines.push("");
    lines.push(entry.note);
    lines.push("");
  }

  lines.push("## Bundled components");
  lines.push("");
  for (const entry of MANUAL_ENTRIES) {
    lines.push(`### ${entry.name}`);
    lines.push("");
    lines.push(`- **Version:** ${entry.version}`);
    lines.push(`- **License:** ${entry.license}`);
    lines.push(`- **Homepage:** ${entry.homepage}`);
    if (entry.source) lines.push(`- **Source:** ${entry.source}`);
    lines.push("");
    lines.push(entry.copyright);
    lines.push("");
    lines.push(entry.note);
    lines.push("");
  }
  lines.push("## npm packages");
  lines.push("");
  lines.push(`${packages.length} packages are distributed inside HARE.`);
  lines.push("");
  lines.push("| Package | Version | License |");
  lines.push("| --- | --- | --- |");
  for (const p of packages) {
    lines.push(`| ${p.name} | ${p.version} | ${p.license} |`);
  }
  lines.push("");
  lines.push("### Full notices");
  lines.push("");
  for (const p of packages) {
    lines.push(`#### ${p.name} — ${p.license}`);
    lines.push("");
    if (p.homepage) lines.push(`${p.homepage}`);
    lines.push("");
    if (p.licenseText) {
      lines.push("```");
      lines.push(p.licenseText);
      lines.push("```");
    } else if (p.copyright) {
      lines.push(p.copyright);
      lines.push("");
      lines.push(
        `_This package ships no license file; it declares \`${p.license}\` in its package.json._`
      );
    } else {
      lines.push(`_This package ships no license file and declares \`${p.license}\`._`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const packages = collect();
const out = render(packages);
fs.writeFileSync(path.join(root, "THIRD-PARTY-NOTICES.md"), out + "\n");
console.log(
  `Wrote THIRD-PARTY-NOTICES.md — ${packages.length} npm packages + ${MANUAL_ENTRIES.length} bundled components + ${RUNTIME_ENTRIES.length} used-not-shipped.`
);

const unknown = packages.filter((p) => p.license === "UNKNOWN");
if (unknown.length > 0) {
  console.warn(
    `\nWARNING: ${unknown.length} package(s) declare no license and ship no license file:\n  ` +
      unknown.map((p) => `${p.name}@${p.version}`).join("\n  ") +
      "\nThese need checking by hand before distributing a build."
  );
  process.exitCode = 1;
}
