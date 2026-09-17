import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// README documents two ways to run this game: `pnpm dev` (Vite) and VS Code's Live Server —
// a plain static file server with no bundler at all. Vite rewrites a bare module specifier
// (`import x from 'some-package'`) to a real URL automatically; a plain static server can't,
// and the browser's native module loader then rejects it outright. Every non-"three" import in
// this project is meant to use a relative path specifically to avoid that trap (see world.js's
// three-mesh-bvh import for why) — this test catches it the way `pnpm test` alone would not,
// since every other e2e test runs through Vite's dev server.
const projectRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const serverScript = path.join(projectRoot, 'tests/e2e/fixtures/static-server.cjs');
const PORT = 5199;

let serverProcess;

test.beforeAll(async () => {
  serverProcess = spawn(process.execPath, [serverScript, projectRoot, String(PORT)], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('static server did not start in time')), 10_000);
    serverProcess.stdout.on('data', chunk => {
      if (chunk.toString().includes(`static-server-ready:${PORT}`)) { clearTimeout(timer); resolve(); }
    });
    serverProcess.on('error', reject);
  });
});

test.afterAll(() => {
  serverProcess?.kill();
});

test('el juego carga sin errores en un servidor estático sin bundler', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await expect(page.getByRole('button', { name: '✦ Crear nuevo mundo' })).toBeVisible();
  await page.getByRole('button', { name: '✦ Crear nuevo mundo' }).click();
  await page.locator('#sizeGrid [data-value="132"]').click();
  await page.getByRole('button', { name: /Generar y jugar/ }).click();
  await expect(page.locator('#mapCreator')).toHaveClass(/hidden/, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  expect(errors).toEqual([]);
});
