import { chromium } from "playwright";
import path from "path";

const OUT = "/cursor/stores/self/media";
const BASE = process.env.CLOSELOOP_URL || "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=CloseLoop");
await page.waitForTimeout(900);
await page.screenshot({
  path: path.join(OUT, "closeloop-bato-home.png"),
});

await page.getByRole("button", { name: /Start remediating/i }).click();
await page.waitForTimeout(700);
await page.screenshot({
  path: path.join(OUT, "closeloop-bato-workspace.png"),
  fullPage: false,
});

await page.getByRole("button", { name: /Remediate & verify/i }).click();
await page.waitForSelector("text=VERIFIED", { timeout: 30000 });
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Evidence" }).click();
await page.locator("text=Differential PoC").first().scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(OUT, "closeloop-bato-evidence.png"),
  fullPage: false,
});

await page.getByRole("button", { name: "Deploy package" }).click();
await page.waitForTimeout(300);
await page.locator("text=CI security gate").first().scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(OUT, "closeloop-bato-deploy.png"),
  fullPage: false,
});

// Mobile hero
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
});
await mobile.goto(BASE, { waitUntil: "networkidle" });
await mobile.waitForTimeout(900);
await mobile.screenshot({
  path: path.join(OUT, "closeloop-bato-mobile.png"),
});

await browser.close();
console.log("Saved bato-styled screenshots to", OUT);
