/**
 * Content for Settings → Help and Settings → About.
 *
 * Kept out of Settings.tsx so that file stays about wiring and state, and
 * this stays about words. Written to the project's copy rule: what a thing
 * is and how to use it, nothing about why it works that way internally.
 */
import { useState } from "react";
import { ChevronDown, ExternalLink, Globe, Mail, Scale, ShieldAlert, Zap } from "lucide-react";
import { Logo } from "../components/Logo";
import {
  APP_VERSION,
  BUILD_STAMP,
  COMPANY,
  OPENRGB_SOURCE_URL,
  PROJECT_URL,
  releaseName,
} from "@/lib/appInfo";
import { BugReport } from "@/components/BugReport";
import licenseText from "../../LICENSE?raw";
import thirdPartyNotices from "../../THIRD-PARTY-NOTICES.md?raw";

interface HelpTopic {
  question: string;
  answer: React.ReactNode;
}

const HELP_TOPICS: HelpTopic[] = [
  {
    question: "How do I change my lighting?",
    answer: (
      <>
        Open <b>My Devices</b> and click any device. From there you can set a solid color, pick an
        animated effect, or use the device's own built-in modes. Changes apply straight away — there's
        nothing to save.
      </>
    ),
  },
  {
    question: "How do I set everything at once?",
    answer: (
      <>
        On <b>My Devices</b>, use <b>Sync everything</b> at the top. Pick an effect, set the color and
        sliders, then hit <b>Sync All</b> to push it to every connected device.
      </>
    ),
  },
  {
    question: "Some of my RGB gear isn't showing up",
    answer: (
      <>
        Try these in order:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>
            Hit <b>Rescan</b> on My Devices.
          </li>
          <li>
            Hit <b>Discover</b> — it checks for new device support, then rescans.
          </li>
          <li>
            <b>Close your other RGB app</b> — iCUE, Armoury Crate, RGB Fusion, Polychrome, MSI
            Center, L-Connect, CAM, SignalRGB. Motherboard, RAM and graphics-card lighting can only
            be driven by one program at a time, and a second one can stop devices appearing at all
            rather than just conflicting. HARE shows a warning on My Devices when it spots one.
          </li>
          <li>
            Motherboard and RAM lighting usually needs HARE to run as administrator. Right-click HARE
            and choose <b>Run as administrator</b>.
          </li>
        </ul>
      </>
    ),
  },
  {
    question: "What's the difference between Effects and Built-in Device Modes?",
    answer: (
      <>
        <b>Effects</b> are HARE's own animations. They work on any device that accepts direct color
        control, and they look identical across all your gear.
        <br />
        <b>Built-in Device Modes</b> are the animations stored in the device's own firmware. They keep
        running even when HARE is closed, but each device only has the ones its maker gave it.
      </>
    ),
  },
  {
    question: "Can my lights match my screen or my music?",
    answer: (
      <>
        Yes — they're effects. Open a device, then pick <b>Screen Sync</b> to follow whatever's on your
        monitor, or <b>Music Reactive</b> to pulse with your audio. You can put them on some devices and
        leave others on a different effect.
      </>
    ),
  },
  {
    question: "How do I save a look I like?",
    answer: (
      <>
        On a device page, set it up how you want, type a name in the box near the top, and hit{" "}
        <b>Save to Gallery</b>. Saved looks live in <b>Gallery</b> and can be applied to any device
        later, or exported to a file to share.
      </>
    ),
  },
  {
    question: "Can I put HARE on a second monitor?",
    answer: (
      <>
        Yes. Open <b>Widget Engine</b> in the sidebar and pick a monitor. HARE fills it with a touch
        panel showing the time, what each device is doing, and one-tap controls. The same page is
        where you choose which widgets appear and drag them where you want them.
      </>
    ),
  },
  {
    question: "Why don't I see any temperatures?",
    answer: (
      <>
        HARE reads what it can without installing a driver: memory and processor load, your graphics
        card, and an AIO cooler's liquid temperature. CPU and case-fan sensors need a hardware monitor
        running — install <b>LibreHardwareMonitor</b> and HARE picks up everything it sees. Check{" "}
        <b>Settings → Hardware → System Sensors</b> to see which sources are working.
      </>
    ),
  },
  {
    question: "A device shows up but its lights don't change",
    answer: (
      <>
        Try <b>Restart OpenRGB</b> in <b>Settings → Hardware</b> first — a device that stops
        responding is usually the engine underneath, not the device. If that doesn't do it, turn on{" "}
        <b>Settings → General → Diagnostic Log</b>, then use <b>Open OpenRGB</b> and try that device
        there. If OpenRGB can't change it either, the problem is below
        HARE — usually the one-time permission in <b>Settings → Hardware</b>, or the PawnIO driver for
        motherboard and RAM lighting. The log records what HARE sent and what the device reported back.
      </>
    ),
  },
  {
    question: "What is Advanced Mode?",
    answer: (
      <>
        At the bottom of any device page. It has three tabs: <b>Mode Parameters</b> for editing a
        built-in mode's speed, direction and colors; <b>LED Painter</b> for clicking individual LEDs to
        set them one by one; and <b>Raw Data</b> showing exactly what the device reports about itself.
        Nothing there can break a device — the worst case is lighting you don't like, which any other
        effect will overwrite.
      </>
    ),
  },
  {
    question: "Where did my settings go when I reinstalled?",
    answer: (
      <>
        Use <b>Backup &amp; Restore</b> on the General tab. <b>Export Settings</b> writes your settings
        and your whole Gallery to one file; <b>Import Settings</b> brings them back.
      </>
    ),
  },
  {
    question: "HARE disappeared when I closed it",
    answer: (
      <>
        Closing the window minimizes HARE to the system tray so your lighting keeps running. Click the
        tray icon to bring it back, or right-click it and choose <b>Quit</b> to close it fully.
      </>
    ),
  },
  {
    question: "My lighting resets when I reboot",
    answer: (
      <>
        HARE's effects run while HARE runs. Turn on <b>Launch HARE when Windows starts</b> on the
        General tab so your lighting comes back automatically. Alternatively, use a{" "}
        <b>Built-in Device Mode</b> — those are stored on the device itself and survive a reboot on
        their own.
      </>
    ),
  },
];

function Collapsible({ topic }: { topic: HelpTopic }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-hare-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-hare-panel2 transition-colors"
      >
        <span className="text-sm font-medium">{topic.question}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-hare-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 text-xs text-hare-muted leading-relaxed">{topic.answer}</div>
      )}
    </div>
  );
}

export function HelpPanel() {
  return (
    <section className="hr-card p-6">
      <h2 className="font-display font-semibold mb-1">Help</h2>
      <p className="text-xs text-hare-muted mb-4">Common questions. Click any one to expand it.</p>
      <div className="space-y-2">
        {HELP_TOPICS.map((topic) => (
          <Collapsible key={topic.question} topic={topic} />
        ))}
      </div>
    </section>
  );
}

function LegalText({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-hare-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-hare-panel2 transition-colors"
      >
        <span className="text-xs font-medium">{label}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-hare-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto border-t border-hare-border bg-hare-panel2 p-3 text-[11px] leading-relaxed text-hare-muted whitespace-pre-wrap font-mono">
          {text}
        </pre>
      )}
    </div>
  );
}

export function AboutPanel() {
  return (
    <div className="space-y-6">
      <section className="hr-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Logo size={38} />
          <div>
            <p className="font-display font-semibold">HARE</p>
            <p className="text-xs text-hare-muted">
              Hardware Adaptive RGB Engine · {releaseName(APP_VERSION)}
            </p>
            <p className="text-[11px] text-hare-muted/80">
              <span className="font-mono">
                {APP_VERSION} · build {BUILD_STAMP}
              </span>
            </p>
          </div>
        </div>
        <p className="text-xs text-hare-muted leading-relaxed flex items-start gap-1.5">
          <Zap size={13} className="mt-0.5 shrink-0 text-glow-amber" />
          One app for every RGB light on your PC.
        </p>
        {/*
          The company's own medallion, shown where authorship is actually
          being stated rather than on every screen — the app's mark is Vinny
          in the RGB badge.
        */}
        <div className="mt-4 flex items-center gap-3 border-t border-hare-border pt-4">
          <Logo size={34} variant="ravitz" />
          <div>
            <p className="text-xs text-hare-muted">Built by</p>
            <p className="font-display text-sm font-semibold">{COMPANY.name}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <a
            href={COMPANY.website}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-hare-muted transition-colors hover:text-glow-violet"
          >
            <Globe size={13} />
            {COMPANY.website.replace(/^https:\/\//, "")}
          </a>
          <a
            href={`mailto:${COMPANY.email}`}
            className="inline-flex items-center gap-1.5 text-xs text-hare-muted transition-colors hover:text-glow-violet"
          >
            <Mail size={13} />
            {COMPANY.email}
          </a>
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-hare-muted transition-colors hover:text-glow-violet"
          >
            <ExternalLink size={13} />
            Source code on GitHub
          </a>
        </div>
      </section>

      <BugReport />

      <section className="hr-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert size={17} className="text-glow-amber" />
          <h2 className="font-display font-semibold">Warranty and liability</h2>
        </div>
        <p className="text-xs text-hare-muted leading-relaxed">
          HARE is provided <b>as is</b>, without warranty of any kind, express or implied. Ravitz
          Computers accepts <b>no responsibility or liability</b> for any damage, data loss, hardware
          fault or other consequence arising from using this software. You use it at your own risk.
        </p>
        <p className="text-xs text-hare-muted leading-relaxed mt-3">
          HARE controls physical hardware, so this applies in full to any effect it has on your
          devices. The complete terms are in the license below.
        </p>
      </section>

      <section className="hr-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Scale size={17} className="text-glow-violet" />
          <h2 className="font-display font-semibold">Licenses</h2>
        </div>
        <p className="text-xs text-hare-muted mb-4">
          HARE is open source under the MIT license, and is built on other open-source software.
        </p>
        <div className="space-y-2">
          <LegalText label="HARE license (MIT)" text={licenseText} />
          <LegalText label="Third-party notices" text={thirdPartyNotices} />
        </div>
        <p className="text-xs text-hare-muted leading-relaxed mt-4">
          HARE controls hardware through{" "}
          <a
            href={OPENRGB_SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-glow-violet hover:underline"
          >
            OpenRGB
          </a>
          , which is licensed under the GNU General Public License, version 2. HARE ships an unmodified
          copy of it; the complete source is available at that link.
        </p>
        <p className="text-xs text-hare-muted leading-relaxed mt-3">
          Builds are produced from public source. If this copy came from an official release you can
          verify it was built from that source rather than altered by someone else — see SIGNING.md in
          the project.
        </p>
        <p className="text-xs text-hare-muted leading-relaxed mt-3">
          Razer, Corsair, Logitech, ASUS, MSI, NZXT, Lian Li, Thermalright and other product names are
          trademarks of their respective owners. HARE is an independent project and is not affiliated
          with or endorsed by any of them.
        </p>
      </section>
    </div>
  );
}
