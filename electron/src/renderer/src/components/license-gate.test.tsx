import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const license = { status: vi.fn(), activate: vi.fn() };
let bridge: { license?: typeof license; files: { openExternal: () => Promise<void> } } | null;
vi.mock('@/components/bridge', () => ({ getBridge: () => bridge }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
import { LicenseGate, trialRemaining } from './license-gate';

const MACHINE = 'VSMH-K4V4-99VS-J484-XGTN';

beforeEach(() => {
  bridge = { license, files: { openExternal: vi.fn().mockResolvedValue(undefined) } };
  license.status.mockReset();
  license.activate.mockReset();
});
afterEach(cleanup);

test('the web build (no Electron bridge) is never gated', () => {
  bridge = null;
  render(<LicenseGate>app</LicenseGate>);
  expect(screen.getByText('app')).toBeInTheDocument();
});

test('a licensed install shows the app with no badge', async () => {
  license.status.mockResolvedValue({ state: 'licensed', machineCode: MACHINE, issuedAt: null });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(screen.queryByText(/activation.trial_left/)).toBeNull();
});

test('a running trial shows the app plus a countdown badge', async () => {
  const endsAt = new Date(Date.now() + 5 * 3_600_000 + 30 * 60_000).toISOString();
  license.status.mockResolvedValue({ state: 'trial', machineCode: MACHINE, endsAt });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(screen.getByText(/activation.trial_left/)).toHaveTextContent('"hours":5');
});

test('an expired trial blocks the app until a key activates it', async () => {
  const expired = { state: 'expired', machineCode: MACHINE, reason: 'trial_ended' } as const;
  license.status.mockResolvedValue(expired);
  license.activate.mockResolvedValueOnce({ ok: false, reason: 'machine', status: expired });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByTestId('license-machine-code')).toHaveTextContent(MACHINE);
  expect(screen.queryByText('app')).toBeNull();
  expect(screen.getByText('activation.expired_trial_ended')).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('VSMH1-…'), { target: { value: 'VSMH1-WRONG' } });
  fireEvent.click(screen.getByRole('button', { name: 'activation.activate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('activation.error_machine');

  license.activate.mockResolvedValueOnce({
    ok: true,
    status: { state: 'licensed', machineCode: MACHINE, issuedAt: '2026-11-15T00:00:00.000Z' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'activation.activate' }));
  });
  await waitFor(() => expect(screen.getByText('app')).toBeInTheDocument());
});

test('trialRemaining rounds up to whole minutes and never goes negative', () => {
  const now = Date.UTC(2026, 10, 15);
  expect(trialRemaining(new Date(now + 90 * 60_000 - 1).toISOString(), now)).toEqual({
    hours: 1,
    minutes: 30,
  });
  expect(trialRemaining(new Date(now - 1000).toISOString(), now)).toEqual({ hours: 0, minutes: 0 });
});
