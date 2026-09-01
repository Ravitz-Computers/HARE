// The Lian Li AIO screen driver, against a simulated cooler.
//
// WHY THIS EXISTS
//
// This is a write path to somebody's cooler that has never been run against
// the hardware it drives — the same position the NZXT driver has always been
// in, and the reason its file opens with a warning. What can be checked
// without hardware is that the bytes leaving HARE are the bytes the protocol
// describes, and that the safeguards around them are real:
//
//   - the panel is asked to answer before anything is written to it,
//   - it is put under HARE's control before a picture is sent, or the
//     cooler's own interface keeps drawing over the top,
//   - there is always a way to give the screen back,
//   - and nothing that isn't a picture is ever sent as one.
//
// Packet layout is checked field by field rather than by comparing whole
// buffers: a test that says "these 1024 bytes changed" tells nobody which
// field is wrong.
import { readFileSync } from "node:fs";
import { LianLiAioLcdDriver } from "../dist-electron/backend/displays/lianLiAioLcdDriver.js";
import {
  FakeLianLiHid,
  withFakeLianLiHid,
  withFakeLianLiInterfaces,
} from "./fake-lianli-screen.mjs";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** A Galahad II LCD, as detectLcdDisplays reports one. */
const SCREEN = {
  vendorId: 0x0416,
  productId: 0x7391,
  name: "Lian Li Galahad II LCD",
  resolutionWidth: 480,
  resolutionHeight: 480,
  controllable: true,
  driver: "lianli-aio",
  capabilities: {
    staticImage: true,
    gif: false,
    video: false,
    brightness: true,
    orientation: true,
    liquidMode: true,
  },
};

const CMD_LCD_CONTROL = 0x0c;
const CMD_SEND_JPEG = 0x0e;

async function withDriver(hid, run) {
  return withFakeLianLiHid(hid, async () => {
    const driver = new LianLiAioLcdDriver(SCREEN);
    const opened = await driver.open();
    try {
      return await run(driver, opened);
    } finally {
      await driver.close();
    }
  });
}

console.log("Lian Li AIO screen driver, against a simulated cooler...\n");

// --- Nothing is written to a cooler that hasn't answered -------------------
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver, opened) => {
    check("opening the cooler succeeds when it answers", opened.ok === true);

    // The first thing sent is the read-only "is the LCD there" query, which
    // is how the right interface gets picked. The handshake comes next, and
    // still comes before anything that changes the panel.
    const first = hid.written[0];
    check("...and the very first packet only asks a question", first[0] === 0x02 && first[1] === 0x17);
    const greeting = hid.written[1];
    check("...with the handshake next", greeting[0] === 0x01 && greeting[1] === 0x81);
    check(
      "...and nothing that changes the screen before either of them",
      hid.written.findIndex((p) => p[1] === 0x0c || p[1] === 0x0e) === -1
    );

    const hello = driver.handshake();
    check("the handshake reports fan speed", hello.status?.fanRpm === 1200);
    check("...pump speed", hello.status?.pumpRpm === 2400);
    check(
      "...and the coolant temperature, to a tenth",
      Math.abs((hello.status?.coolantC ?? 0) - 31.4) < 0.05
    );
  });
}

{
  // A cooler that says its temperature reading isn't valid must not have a
  // number invented for it. Reporting 0 C from a cooler that said "no reading"
  // is exactly the kind of confident wrong answer this project keeps removing.
  const hid = new FakeLianLiHid({ tempValid: false });
  await withDriver(hid, async (driver) => {
    const hello = driver.handshake();
    check("a cooler with no valid temperature reports none, rather than zero", hello.status?.coolantC === null);
  });
}

// --- A panel that ignores being driven ------------------------------------
//
// The Galahad II LCD (Vision) on the machine this was reported from takes the
// control message, does nothing, and says nothing. HARE said "Done." to both
// taking the screen over and handing it back, and the owner reported the
// picture landing under the cooler's own display and Reset to stock doing
// nothing — twice, with an empty log behind both, because the reply was
// discarded twenty milliseconds after the write.
{
  const hid = new FakeLianLiHid({ answersControl: false });
  await withDriver(hid, async (driver) => {
    const claimed = driver.setDisplay(60, 0);
    check("a panel that ignores the control message is not reported as success", claimed.ok === false);
    check(
      "...and the message says the screen didn't answer, in words",
      /didn't answer/.test(claimed.ok === false ? claimed.message : "")
    );

    const handed = driver.handBack();
    check("handing the screen back to a panel that ignores it also says so", handed.ok === false);

    // The message still has to leave: it is what a log or a packet capture
    // has to show for anyone to work out what the panel does want.
    check(
      "...and the command was still actually sent, so there is something to look at",
      hid.packetsFor(0x0c).length === 2
    );
  });
}

// --- The screen is claimed before a picture lands on it --------------------
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    const result = driver.setDisplay(60, 180);
    check("setting the display succeeds", result.ok === true);

    const [control] = hid.packetsFor(CMD_LCD_CONTROL);
    check("the control packet is sent on report 2", control?.[0] === 0x02);
    check("...as command 0x0C", control?.[1] === CMD_LCD_CONTROL);
    // Payload starts at byte 11. Mode 1 is "an application is driving this",
    // which is what stops the cooler's own UI drawing underneath.
    check("...claiming the panel for HARE (mode 1)", control?.[11] === 1);
    check("...carrying the brightness asked for", control?.[12] === 60);
    check("...and 180 degrees encoded as 2, not as 180", control?.[13] === 2);
  });
}

// --- Giving it back --------------------------------------------------------
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    const result = driver.handBack();
    check("the screen can be given back to the cooler", result.ok === true);
    const [control] = hid.packetsFor(CMD_LCD_CONTROL);
    check("...which is mode 0, the cooler's own display", control?.[11] === 0);
  });
}

// --- A picture, in as many packets as it takes -----------------------------
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    // Big enough to need several packets: 1013 bytes fit in each.
    const jpeg = new Uint8Array(2500);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    for (let i = 2; i < jpeg.length; i++) jpeg[i] = i % 251;
    jpeg[jpeg.length - 2] = 0xff;
    jpeg[jpeg.length - 1] = 0xd9;

    const result = driver.sendJpeg(jpeg);
    check("a multi-packet picture is accepted", result.ok === true);

    const packets = hid.packetsFor(CMD_SEND_JPEG);
    check(`it takes 3 packets for 2500 bytes at 1013 each (${packets.length})`, packets.length === 3);

    // Every packet repeats the size of the WHOLE transfer, big-endian.
    const totals = packets.map((p) => (p[2] << 24) | (p[3] << 16) | (p[4] << 8) | p[5]);
    check(
      "every packet carries the total size of the picture",
      totals.every((t) => t === 2500)
    );
    const nums = packets.map((p) => (p[6] << 16) | (p[7] << 8) | p[8]);
    check("...and its own number, counting from zero", nums.join() === "0,1,2");
    const lens = packets.map((p) => (p[9] << 8) | p[10]);
    check("...and how much of itself is payload", lens.join() === "1013,1013,474");

    // The bytes have to arrive intact and in order. Reassembling is the only
    // check that catches an off-by-one in the chunk maths, which would show
    // up on the hardware as a torn or blank picture.
    const received = hid.payloadFor(CMD_SEND_JPEG);
    check("the picture arrives whole", received.length === jpeg.length);
    check(
      "...and unchanged, byte for byte",
      received.every((b, i) => b === jpeg[i])
    );
  });
}

// --- What must never be sent ----------------------------------------------
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    const before = hid.packetsFor(CMD_SEND_JPEG).length;

    const notAJpeg = driver.sendJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    check("something that isn't a JPEG is refused", notAJpeg.ok === false);

    const empty = driver.sendJpeg(new Uint8Array(0));
    check("...as is nothing at all", empty.ok === false);

    const huge = driver.sendJpeg(
      (() => {
        const b = new Uint8Array(5 * 1024 * 1024);
        b[0] = 0xff;
        b[1] = 0xd8;
        return b;
      })()
    );
    check("...as is something far too big for the panel", huge.ok === false);

    check(
      "and none of them put a single packet on the wire",
      hid.packetsFor(CMD_SEND_JPEG).length === before
    );
  });
}

// --- A cooler that isn't there ---------------------------------------------
{
  const hid = new FakeLianLiHid();
  hid.readTimeout = () => [];
  await withFakeLianLiHid(hid, async () => {
    const driver = new LianLiAioLcdDriver(SCREEN);
    const opened = await driver.open();
    check("a cooler that never answers is not opened", opened.ok === false);
    check(
      "...and says so in words rather than an error code",
      opened.ok === false && /didn't answer/.test(opened.message)
    );
    await driver.close();
  });
}

// --- A command the panel ignores is not reported as success ---------------
//
// On a real Galahad II LCD (Vision) the LCD-control command does nothing: a
// picture arrives and is drawn underneath the cooler's own display, and
// handing the screen back changes nothing at all. HARE said "Done." to both,
// because the transfer is fire-and-forget and nothing was ever read back.
//
// That is the part worth fixing before the protocol question. Two rounds went
// by without anyone being able to tell whether the message was even arriving,
// because the only evidence — the panel's reply, or its silence — was being
// discarded twenty milliseconds after the write.
{
  const driver = readFileSync("electron/backend/displays/lianLiAioLcdDriver.ts", "utf8");

  check(
    "an LCD-control message waits properly for a reply, unlike a picture's ack",
    /CONTROL_REPLY_TIMEOUT_MS/.test(driver) &&
      /sendBCommand\(CMD_LCD_CONTROL, payload, CONTROL_REPLY_TIMEOUT_MS\)/.test(driver)
  );
  check(
    "...and a panel that says nothing is reported as such, not as done",
    /reply\.length === 0/.test(driver) && /didn't answer/.test(driver)
  );
  check(
    "...with what was sent and what came back written to the log",
    /toString\(16\)/.test(driver) && /screen replied/.test(driver)
  );
  check(
    "taking the screen over, adjusting it and handing it back all go through that check",
    (driver.match(/this\.sendControl\(/g) ?? []).length === 3
  );

  // The picture must still be sent when the claim is ignored: it is what the
  // owner can actually see, and it is the evidence that anything arrives at
  // all. Refusing to send it would turn "it's behind the clock" into
  // "nothing happens".
  const adapter = readFileSync("electron/backend/displays/screenDriver.ts", "utf8");
  const send = adapter.slice(adapter.indexOf("async setStaticImage"), adapter.indexOf("async setGif"));
  check(
    "a picture is still sent when the panel won't hand the screen over",
    /const drawn = this\.driver\.sendJpeg\(jpeg\);/.test(send) &&
      send.indexOf("sendJpeg(jpeg)") > send.indexOf("setDisplay(this.brightness")
  );
  check(
    "...and the result says the screen wasn't handed over",
    /if \(!claimed\.ok\)/.test(send) && send.indexOf("if (!claimed.ok)") > send.indexOf("const drawn")
  );
}


// --- Finding the interface the screen is actually behind -------------------
//
// These coolers enumerate as several HID interfaces under one vendor and
// product id: the pump and fans on one, the panel on another. HARE opened
// whichever the operating system listed first, which is a coin toss dressed up
// as a decision — and getting it wrong produces no error at all. Writes
// succeed, the handshake answers, and nothing appears on the screen. That is
// indistinguishable, from the outside, from a panel that ignores the commands.
//
// `0x17` is the reference implementation's own "is the LCD there" query. It
// reads and changes nothing, so asking every interface costs one message each.
{
  const fans = new FakeLianLiHid({ hasLcd: false });
  const panel = new FakeLianLiHid({ hasLcd: true });

  await withFakeLianLiInterfaces([fans, panel], async () => {
    const driver = new LianLiAioLcdDriver(SCREEN);
    const opened = await driver.open();
    try {
      check("a cooler with the screen on its second interface still opens", opened.ok === true);
      check("...and the interface without the screen is asked first", fans.written.length > 0);

      driver.setDisplay(80, 0);
      check(
        "...but the picture commands go to the one that has it",
        panel.packetsFor(0x0c).length === 1 && fans.packetsFor(0x0c).length === 0
      );
    } finally {
      await driver.close();
    }
  });
}

// --- And when nothing claims the screen ------------------------------------
//
// A panel that doesn't implement the query must not be locked out by HARE
// becoming more careful — that would break screens that work today. The first
// interface is used, exactly as before, and the log says so.
{
  const silent = new FakeLianLiHid({ answersAvailable: false });
  await withFakeLianLiInterfaces([silent], async () => {
    const driver = new LianLiAioLcdDriver(SCREEN);
    const opened = await driver.open();
    try {
      check("a cooler that won't answer the question is still opened", opened.ok === true);
    } finally {
      await driver.close();
    }
  });
}

// --- A stale reply is not mistaken for the answer --------------------------
//
// Acknowledgements from an earlier transfer sit in the queue. Reading once
// takes whatever is at the front, so an interface with no screen behind it
// could answer "yes" with someone else's packet — and HARE would then send
// every frame to the fan controller.
{
  const panel = new FakeLianLiHid({ hasLcd: true, decoyReplies: 3 });
  await withFakeLianLiInterfaces([panel], async () => {
    const driver = new LianLiAioLcdDriver(SCREEN);
    const opened = await driver.open();
    try {
      check("the answer is found past replies left over from earlier commands", opened.ok === true);
    } finally {
      await driver.close();
    }
  });
}

// --- Adjusting the panel is not the same message as claiming it ------------
//
// The reference implementation sends mode 1 to take the screen over and mode 4
// for a brightness or rotation change. HARE sent mode 1 for both, so every
// drag of the brightness slider re-announced an application taking the panel
// over.
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    driver.setDisplay(70, 90);
    driver.setLcdSetting(40, 180);
    const payloads = hid.packetsFor(0x0c).map((p) => p.slice(11, 19));

    check("taking the screen over is mode 1", payloads[0]?.[0] === 1);
    check("...and adjusting it is mode 4", payloads[1]?.[0] === 4);
    check("...carrying the brightness asked for", payloads[1]?.[1] === 40);
    check("...and the rotation, as a quarter-turn count", payloads[1]?.[2] === 2);
  });
}


// --- A cooler that repeats the command back instead of acting on it --------
//
// This is what a Galahad II LCD (Vision) actually does. Every control message
// comes back byte for byte — header, packet number, payload — and the panel
// keeps drawing its own display. From the outside that reply is
// indistinguishable from success, and it is why "reset to stock does nothing"
// went several rounds: HARE was reading an answer and calling it an
// acknowledgement.
//
// The same interface returns nothing for the "is the LCD there" query, which
// is the other half of the picture: this is one HID interface on a device
// whose screen is somewhere HARE cannot reach.
{
  const hid = new FakeLianLiHid({ echoesControl: true });
  await withDriver(hid, async (driver) => {
    const claimed = driver.setDisplay(80, 0);
    check("a cooler that echoes the command is not reported as success", claimed.ok === false);
    check(
      "...and the message says the screen isn't on the connection HARE can reach",
      /can't drive its screen/.test(claimed.ok === false ? claimed.message : "")
    );
    check("...and the driver remembers, so the caller can stop trying", driver.refusesToBeDriven === true);
  });
}

// --- An echo is told apart from a real status reply ------------------------
//
// Comparing a byte or two would throw away a genuine reply that happens to
// start the same way, and then a working panel would be declared broken.
{
  const hid = new FakeLianLiHid();
  await withDriver(hid, async (driver) => {
    const claimed = driver.setDisplay(80, 0);
    check("a status reply that isn't the request is still success", claimed.ok === true);
    check("...and the cooler is not written off", driver.refusesToBeDriven === false);
  });
}


console.log("");
if (failures > 0) {
  console.error(`ALL_LIANLI_SCREEN_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_LIANLI_SCREEN_CHECKS_PASSED");
