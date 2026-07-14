import { readFile } from 'node:fs/promises';
import { describe, expect, test } from '@jest/globals';
import { APP_VERSION } from '../../src/version.js';

describe('release version', () => {
  test('uses valid semver and matches package metadata', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(pkg.version);
  });
});

