import { chromium } from "playwright";
import path from "node:path";

const OUT_DIR = "/home/claude/hare/screenshots";
const URL = "http://localhost:4175/";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(URL, { waitUntil: "networkidle" });

  // Onboarding screen
  await page.waitForTimeout(2200); // let the "scanning" phase resolve
  await page.screenshot({ path: path.join(OUT_DIR, "1-onboarding.png") });

  await page.getByRole("button", { name: /let's go/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "2-dashboard.png") });

  // Open first device
  await page.locator("button:has-text('Ironclad')").first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, "3-device-detail.png") });

  // Pick the rainbow-wave effect card and let its preview animate a beat
  await page.locator("button:has-text('Rainbow Wave')").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "4-device-effect-selected.png") });

  // Back to dashboard, go to Effects page
  await page.locator("button:has-text('Back to devices')").click();
  await page.waitForTimeout(300);
  await page.locator("nav button:has-text('Effects')").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "5-effects-page.png") });

  // Settings page
  await page.locator("nav button:has-text('Settings')").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "6-settings-page.png") });

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
