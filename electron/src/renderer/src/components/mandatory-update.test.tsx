import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  policy: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({
    license: { updatePolicy: mock.policy },
    updates: {
      check: mock.check,
      download: mock.download,
      install: mock.install,
      onState: () => () => undefined,
    },
    files: { openExternal: mock.open },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'vi' } }),
}));
import { MandatoryUpdateGate } from './mandatory-update';

const base = { currentVersion: '1.0.0', progress: 0 };
beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset();
});

it('keeps the app usable when no minimum version is set or the server is offline', async () => {
  mock.policy.mockResolvedValue({
    required: false,
    minVersion: null,
    latestVersion: null,
    message: '',
    downloadUrl: 'x',
  });
  render(<MandatoryUpdateGate>app body</MandatoryUpdateGate>);
  await waitFor(() => expect(mock.policy).toHaveBeenCalled());
  expect(screen.getByText('app body')).toBeTruthy();
  expect(mock.check).not.toHaveBeenCalled();
});

it('blocks an old version, downloads the update and restarts to install it', async () => {
  mock.policy.mockResolvedValue({
    required: true,
    minVersion: '1.0.1',
    latestVersion: '1.0.1',
    message: 'Bản mới sửa lỗi',
    downloadUrl: 'https://active.mrhuynh.net/downloads/',
  });
  mock.check.mockResolvedValue({ ...base, status: 'available' });
  mock.download.mockResolvedValue({ ...base, status: 'downloaded', progress: 100 });
  render(<MandatoryUpdateGate>app body</MandatoryUpdateGate>);
  await screen.findByText('Bản mới sửa lỗi');
  expect(screen.queryByText('app body')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /activation.update_restart/ }));
  expect(mock.install).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /activation.update_open_page/ }));
  expect(mock.open).toHaveBeenCalledWith('https://active.mrhuynh.net/downloads/');
});
