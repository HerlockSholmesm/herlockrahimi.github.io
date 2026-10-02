// Render cv/cv.html to assets/CV.pdf with headless Chromium.
// Usage: node cv/build.mjs   (needs the `playwright` package)
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, "cv.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: path.join(here, "..", "assets", "CV.pdf"), format: "Letter", preferCSSPageSize: true, printBackground: true });
await browser.close();
