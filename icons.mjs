// Renders assets/icon.svg into the PNG sizes Chrome asks for.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const svg = readFileSync(at('./assets/icon.svg'), 'utf8');
mkdirSync(at('./extension/icons'), { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html, body { margin: 0; background: transparent; } svg { display: block; width: ${size}px; height: ${size}px; }</style>${svg}`);
  await page.screenshot({ path: at(`./extension/icons/icon-${size}.png`), omitBackground: true });
}
await browser.close();
