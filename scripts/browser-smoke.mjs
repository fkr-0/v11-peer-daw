#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright';

const port = Number(process.env.V11_PEER_DAW_SMOKE_PORT || 4173);
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          if (response.statusCode && response.statusCode < 500) resolve();
          else reject(new Error(`HTTP ${response.statusCode}`));
        });
        request.on('error', reject);
        request.setTimeout(1000, () => request.destroy(new Error('timeout')));
      });
      return;
    } catch (_) {
      await wait(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startPreview() {
  const child = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', host, '--port', String(port), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    }
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) output += `\npreview exited with code ${code}`;
    if (signal) output += `\npreview exited with signal ${signal}`;
  });
  return { child, output: () => output };
}

function assertNoPageErrors(errors) {
  if (errors.length) {
    throw new Error(`Browser page errors:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
}

async function runSmoke() {
  const preview = startPreview();
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      assertNoPageErrors(errors);
      await page.waitForSelector('#patchCanvas', { state: 'attached' });
      await page.waitForSelector('#workspaceMainView', { state: 'attached' });
      await page.waitForSelector('[data-workspace-view="session"]');

      const patchBox = await page.locator('#patchCanvas').boundingBox();
      if (!patchBox || patchBox.width <= 0 || patchBox.height <= 0) {
        throw new Error(`Patch canvas has invalid bounding box: ${JSON.stringify(patchBox)}`);
      }

      const workspaceViews = ['session', 'chains', 'clips', 'arrangement', 'mixer', 'module'];
      for (const view of workspaceViews) {
        await page.click(`[data-workspace-view="${view}"]`);
        await page.waitForFunction(
          (expected) => document.querySelector('#workspaceMainView')?.textContent?.trim().length > 0 && document.querySelector(`[data-workspace-view="${expected}"]`),
          view
        );
        const state = await page.evaluate((expected) => {
          const workspace = document.querySelector('#workspaceMainView');
          const tab = document.querySelector(`[data-workspace-view="${expected}"]`);
          return {
            expected,
            hasTab: Boolean(tab),
            tabClass: tab?.className || '',
            textLength: workspace?.textContent?.trim().length || 0,
            textPreview: workspace?.textContent?.trim().slice(0, 120) || '',
          };
        }, view);
        if (!state.hasTab || state.textLength <= 0) {
          throw new Error(`Workspace view did not render: ${JSON.stringify(state)}`);
        }
      }

      await page.locator('details.sidebar-drawer', { hasText: 'Examples' }).evaluate((el) => {
        el.open = true;
      });
      for (const exampleId of [
        'detroit-pocket-conant-gardens-study',
        'fall-in-love-remix-sketch',
      ]) {
        await page.selectOption('#exampleProjectSelect', exampleId);
        await page.click('#btnLoadExampleProject');
        await page.click('[data-workspace-view="clips"]');
        const firstClip = page.locator('[data-clip-slot-row]').first();
        await firstClip.waitFor({ state: 'visible' });
        const clipText = await firstClip.textContent();
        if (!clipText?.includes('Module:') || !clipText.includes('Chain:')) {
          throw new Error(`Clip row lacks module/chain orientation for ${exampleId}: ${clipText}`);
        }
        await firstClip.locator('[data-clip-action="launch"]').click();
        await page.waitForFunction(() => document.querySelector('[data-clip-slot-row]')?.textContent?.includes('playing'));
        await firstClip.locator('[data-clip-action="stop"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-clip-slot-row]')?.textContent?.includes('playing'));
        await firstClip.locator('[data-workspace-view-target="module"]').first().click();
        await page.waitForFunction(() => document.querySelector('#workspaceMainView')?.textContent?.match(/Open|notes|grid|Pad|Sample|Envelope/i));
        await page.click('[data-workspace-view="chains"]');
        await page.waitForSelector('[data-chain-card]', { state: 'visible' });
        const chainText = await page.locator('[data-chain-card]').first().textContent();
        if (!chainText?.includes('Source:') || !chainText.includes('Processor/Mixer:') || !chainText.includes('Output:')) {
          throw new Error(`Chain card lacks role labels for ${exampleId}: ${chainText}`);
        }
      }

      const moduleCards = await page.locator('.module-card').count();
      if (moduleCards <= 0) throw new Error('Expected at least one rendered module card');

      const sampleLibraryBox = await page.locator('#sampleLibraryTree').boundingBox();
      if (!sampleLibraryBox || sampleLibraryBox.width <= 0 || sampleLibraryBox.height <= 0) {
        throw new Error(
          `Sample library panel has invalid bounding box: ${JSON.stringify(sampleLibraryBox)}`
        );
      }
      const missingSamplesBox = await page.locator('#missingSampleSlots').boundingBox();
      if (!missingSamplesBox || missingSamplesBox.width <= 0 || missingSamplesBox.height <= 0) {
        throw new Error(
          `Missing sample panel has invalid bounding box: ${JSON.stringify(missingSamplesBox)}`
        );
      }
      const sampleLibraryText = await page.locator('#sampleLibraryTree').textContent();
      if (!sampleLibraryText?.includes('/library')) {
        throw new Error(`Sample library tree did not render root label: ${sampleLibraryText}`);
      }
      const missingSampleText = await page.locator('#missingSampleSlots').textContent();
      if (!missingSampleText?.trim()) throw new Error('Missing sample panel rendered empty text');
      const sampleCards = await page.locator('.sample-slot-card').count();
      if (sampleCards > 0) {
        const queryButtons = await page.locator('[data-sample-action="query-peer"]').count();
        if (queryButtons <= 0)
          throw new Error('Sample slot cards did not expose peer-query actions');
      }
      assertNoPageErrors(errors);
    } finally {
      await browser.close();
    }
  } finally {
    preview.child.kill('SIGTERM');
  }
}

runSmoke()
  .then(() => console.log(`browser smoke OK: ${baseUrl}`))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
