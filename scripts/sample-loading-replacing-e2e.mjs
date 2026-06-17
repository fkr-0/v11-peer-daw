#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = Number(process.env.V11_PEER_DAW_SAMPLE_E2E_PORT || 4174);
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
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } }
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

function writeFakeWav(dir, name, marker) {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(`RIFF$\0\0\0WAVEfmt ${marker}`));
  return path;
}

async function projectSamplerFilename(page) {
  return page.evaluate(() => {
    const project = window.v11PeerDAW?.serializeRig?.();
    const sampler = project?.modules?.find((module) =>
      [module.moduleType, module.kind, module.id, module.title]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes('sampler'))
    );
    return sampler?.sampleMetadata?.filename || sampler?.fileName || null;
  });
}

async function runSampleE2E() {
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
      await page.selectOption('#addModule', 'sampler');
      await page.waitForSelector('.module-card[data-module-id]', { state: 'visible' });

      const sampleDir = mkdtempSync(join(tmpdir(), 'v11-peer-daw-sample-e2e-'));
      const firstPath = writeFakeWav(sampleDir, 'same-name.wav', 'FIRST');
      const duplicateDir = join(sampleDir, 'duplicate');
      mkdirSync(duplicateDir);
      const duplicateNamePath = writeFakeWav(duplicateDir, 'same-name.wav', 'SECOND');
      const replacementPath = writeFakeWav(sampleDir, 'replacement-snare.wav', 'REPLACEMENT');

      await page.setInputFiles('#sampleLibraryUploadFile', [firstPath, duplicateNamePath]);
      await page.click('[data-workspace-view="samples"]');
      await page.waitForSelector('.sample-library-matrix', { state: 'visible' });
      await page.waitForSelector('[data-sample-action="select-library-sample"]', {
        state: 'visible',
      });

      const libraryRowsAfterImport = await page.locator('.sample-matrix-file').count();
      if (libraryRowsAfterImport < 2) {
        throw new Error(
          `Expected duplicate-name uploads to remain distinct rows, got ${libraryRowsAfterImport}`
        );
      }

      const targetSlot = page.locator('.sample-matrix-slot').first();
      await targetSlot.waitFor({ state: 'visible' });
      const disabledAssignCount = await targetSlot
        .locator('[data-sample-action="assign-selected"][disabled]')
        .count();
      if (disabledAssignCount !== 1) {
        throw new Error('Assign button should be disabled until a library file is selected.');
      }

      await page.locator('[data-sample-action="select-library-sample"]').first().click();
      await page.waitForFunction(() =>
        document.querySelector('.sample-library-matrix')?.textContent?.includes('Selected sample')
      );
      await targetSlot.locator('[data-sample-action="assign-selected"]').click();
      await page
        .waitForFunction(
          () =>
            window.v11PeerDAW
              ?.serializeRig?.()
              ?.modules?.some((module) => module.sampleMetadata?.filename === 'same-name.wav'),
          null,
          { timeout: 5000 }
        )
        .catch(() => {
          throw new Error(
            'Initial selected-sample assignment did not persist same-name.wav in project JSON'
          );
        });

      const assignedFilename = await projectSamplerFilename(page);
      if (assignedFilename !== 'same-name.wav') {
        throw new Error(
          `Expected initial assignment to persist in project JSON, got ${assignedFilename}`
        );
      }

      await targetSlot.locator('[data-sample-action="pick-upload"]').click();
      await page.setInputFiles('#sampleLibraryUploadFile', replacementPath);
      await page
        .waitForFunction(
          () =>
            window.v11PeerDAW
              ?.serializeRig?.()
              ?.modules?.some(
                (module) => module.sampleMetadata?.filename === 'replacement-snare.wav'
              ),
          null,
          { timeout: 5000 }
        )
        .catch(() => {
          throw new Error(
            'Slot-targeted upload replacement did not persist replacement-snare.wav in project JSON'
          );
        });

      const replacedFilename = await projectSamplerFilename(page);
      if (replacedFilename !== 'replacement-snare.wav') {
        throw new Error(
          `Expected slot-targeted replacement to persist in project JSON, got ${replacedFilename}`
        );
      }

      await page.click('[data-workspace-view="samples"]');
      await page
        .locator('.sample-matrix-slot')
        .first()
        .locator('[data-sample-action="open-editor"]')
        .click();
      await page
        .waitForFunction(
          () =>
            document
              .querySelector('#workspaceMainView')
              ?.textContent?.includes('replacement-snare.wav'),
          null,
          { timeout: 5000 }
        )
        .catch(() => {
          throw new Error(
            'Opening the replaced sample slot did not show replacement-snare.wav in the module editor'
          );
        });

      await page.click('[data-workspace-view="samples"]');
      const matrixText = await page.locator('.sample-library-matrix').textContent();
      if (!matrixText?.includes('same-name.wav') || !matrixText.includes('replacement-snare.wav')) {
        throw new Error(`Sample matrix lost library/replacement validation text: ${matrixText}`);
      }

      assertNoPageErrors(errors);
    } finally {
      await browser.close();
    }
  } finally {
    preview.child.kill('SIGTERM');
  }
}

runSampleE2E()
  .then(() => console.log(`sample loading/replacing e2e OK: ${baseUrl}`))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
