import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const license = {
  status: vi.fn(),
  activate: vi.fn(),
  plans: vi.fn(),
  createOrder: vi.fn(),
  checkOrder: vi.fn(),
};
let bridge: { license?: typeof license; files: { openExternal: () => Promise<void> } } | null;
vi.mock('@/components/bridge', () => ({ getBridge: () => bridge }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'vi' },
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
import { daysLeft, LicenseGate, trialRemaining } from './license-gate';

const MACHINE = 'VSMH-K4V4-99VS-J484-XGTN';

beforeEach(() => {
  bridge = { license, files: { openExternal: vi.fn().mockResolvedValue(undefined) } };
  for (const fn of Object.values(license)) fn.mockReset();
  license.plans.mockResolvedValue({ ok: false, error: 'offline' });
});
afterEach(cleanup);

test('the web build (no Electron bridge) is never gated', () => {
  bridge = null;
  render(<LicenseGate>app</LicenseGate>);
  expect(screen.getByText('app')).toBeInTheDocument();
});

test('a licensed install shows the app with no badge', async () => {
  license.status.mockResolvedValue({
    state: 'licensed',
    machineCode: MACHINE,
    plan: 'permanent',
    expiresAt: null,
  });
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

  fireEvent.click(screen.getByRole('tab', { name: 'activation.tab_key' }));
  fireEvent.change(screen.getByPlaceholderText('VSMH2-…'), { target: { value: 'VSMH1-WRONG' } });
  fireEvent.click(screen.getByRole('button', { name: 'activation.activate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('activation.error_machine');

  license.activate.mockResolvedValueOnce({
    ok: true,
    status: {
      state: 'licensed',
      machineCode: MACHINE,
      plan: 'month1',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
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

test('buying a plan shows the QR and activates by itself once the payment lands', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const expired = { state: 'expired', machineCode: MACHINE, reason: 'trial_ended' } as const;
  license.status.mockResolvedValue(expired);
  license.plans.mockResolvedValue({
    ok: true,
    plans: [
      { id: 'month1', label: '1 tháng', price: 55000 },
      { id: 'permanent', label: 'Vĩnh viễn', price: 1000000 },
    ],
  });
  license.createOrder.mockResolvedValue({
    ok: true,
    order: {
      code: 'ACT7K4M9Q2T',
      plan: 'month1',
      planLabel: '1 tháng',
      amount: 55000,
      bank: 'BIDV',
      account: '9624788159',
      holder: 'HUYNH XUYEN SON',
      content: 'ACT7K4M9Q2T',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      qrDataUrl: 'data:image/png;base64,AA==',
    },
  });
  license.checkOrder
    .mockResolvedValueOnce({ ok: true, state: { status: 'pending', paidAmount: 0 } })
    .mockResolvedValueOnce({
      ok: true,
      state: { status: 'paid' },
      activation: {
        ok: true,
        status: {
          state: 'licensed',
          machineCode: MACHINE,
          plan: 'month1',
          expiresAt: '2026-12-15T00:00:00.000Z',
        },
      },
    });
  render(<LicenseGate>app</LicenseGate>);
  fireEvent.click(await screen.findByText('activation.plan_month1'));
  expect(license.createOrder).toHaveBeenCalledWith('month1');
  expect(await screen.findByText('9624788159')).toBeInTheDocument();
  expect(screen.getAllByText('ACT7K4M9Q2T').length).toBeGreaterThan(0);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AA==');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_500);
  });
  expect(license.checkOrder).toHaveBeenCalledWith('ACT7K4M9Q2T');
  await waitFor(() => expect(screen.getByText('app')).toBeInTheDocument());
  vi.useRealTimers();
});

test('an offline store points to manual keys instead of failing silently', async () => {
  license.status.mockResolvedValue({
    state: 'expired',
    machineCode: MACHINE,
    reason: 'trial_ended',
  });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByRole('alert')).toHaveTextContent('activation.store_error_offline');
});

test('a plan expiring within a week shows a renew reminder', async () => {
  const expiresAt = new Date(Date.now() + 3 * 86_400_000 - 1000).toISOString();
  license.status.mockResolvedValue({
    state: 'licensed',
    machineCode: MACHINE,
    plan: 'month1',
    expiresAt,
  });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByText(/activation.renew_badge/)).toHaveTextContent('"days":3');
  expect(daysLeft(expiresAt)).toBe(3);
});

test('the expired screen names the plan that ended', async () => {
  license.status.mockResolvedValue({
    state: 'expired',
    machineCode: MACHINE,
    reason: 'license_ended',
    plan: 'month3',
    expiredAt: '2026-12-15T00:00:00.000Z',
  });
  render(<LicenseGate>app</LicenseGate>);
  expect(await screen.findByText(/activation.expired_license_ended/)).toHaveTextContent(
    'activation.plan_month3',
  );
});

test('all plans sit in one row with their own colour, and only three contacts show', async () => {
  license.status.mockResolvedValue({
    state: 'expired',
    machineCode: MACHINE,
    reason: 'trial_ended',
  });
  license.plans.mockResolvedValue({
    ok: true,
    plans: [
      { id: 'month1', label: '1 tháng', price: 55000 },
      { id: 'month3', label: '3 tháng', price: 150000 },
      { id: 'year1', label: '1 năm', price: 500000 },
      { id: 'permanent', label: 'Vĩnh viễn', price: 1000000 },
    ],
  });
  const { container } = render(<LicenseGate>app</LicenseGate>);
  await screen.findByText('activation.plan_permanent');
  const cards = container.querySelectorAll('[data-plan]');
  expect(cards).toHaveLength(4);
  expect((cards[0]!.parentElement as HTMLElement).style.gridTemplateColumns).toBe(
    'repeat(4, minmax(0, 1fr))',
  );
  expect(cards[0]!.className).toContain('sky');
  expect(cards[3]!.className).toContain('amber');
  // 3 tháng 150.000đ so với 3 × 55.000đ: tiết kiệm 9%; 1 năm: 24%.
  expect(screen.getByText('activation.save_percent {"percent":9}')).toBeInTheDocument();
  expect(screen.getByText('activation.save_percent {"percent":24}')).toBeInTheDocument();
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links).toEqual(['Facebook', 'Website', 'Zalo']);
});
