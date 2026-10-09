import { chromium } from "playwright";
import path from "path";

const OUT = "/cursor/stores/self/media";
const BASE = process.env.CLOSELOOP_URL || "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=CloseLoop");
await page.screenshot({
  path: path.join(OUT, "closeloop-dashboard.png"),
  fullPage: true,
});

await page.getByRole("button", { name: /Remediate & verify/i }).click();
await page.waitForSelector("text=VERIFIED", { timeout: 30000 });
await page.waitForTimeout(600);

await page.getByRole("button", { name: "Evidence" }).click();
await page.waitForTimeout(300);
await page.locator("text=Differential PoC").first().scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(OUT, "closeloop-evidence.png"),
  fullPage: true,
});

await page.getByRole("button", { name: "Deploy package" }).click();
await page.waitForTimeout(300);
await page.locator("text=CI security gate").first().scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(OUT, "closeloop-deploy.png"),
  fullPage: true,
});

await browser.close();
console.log("Saved screenshots to", OUT);
