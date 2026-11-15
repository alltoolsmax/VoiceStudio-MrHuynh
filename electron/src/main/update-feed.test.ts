import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// Voice Studio - Mr.Huỳnh: app tìm bản cập nhật ở đúng nơi bộ cài ghi vào app-update.yml.
const FEED = 'https://active.mrhuynh.net/downloads';

test('the updater and the installer agree on the hosting update feed', () => {
  const updater = readFileSync(join(__dirname, 'updater.ts'), 'utf8');
  const builder = readFileSync(join(__dirname, '../../electron-builder.config.mjs'), 'utf8');
  expect(updater).toContain(`export const STABLE_FEED = '${FEED}';`);
  expect(builder).toContain(`const updateUrl = '${FEED}';`);
  expect(updater).not.toMatch(/const STABLE_FEED = 'https:\/\/github\.com/);
});
