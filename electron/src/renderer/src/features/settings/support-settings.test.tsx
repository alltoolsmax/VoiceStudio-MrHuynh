import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { openExternal: vi.fn().mockResolvedValue(undefined) } }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { SupportSettings } from './support-settings';
afterEach(cleanup);

it('shows only the Mr.Huỳnh support channels', () => {
  render(<SupportSettings />);
  const expected = {
    Facebook: 'https://facebook.com/mr.huynhxuyenson',
    Telegram: 'https://t.me/mrhuynh1985',
    YouTube: 'https://www.youtube.com/channel/UCwSbzgfgu1iMfOR__AB4QGQ?sub_confirmation=1',
    Website: 'https://mrhuynh.net',
    'Zalo Group': 'https://zalo.me/g/lzcnxj126',
    Zalo: 'https://zalo.me/0979007367',
  };
  for (const [name, href] of Object.entries(expected)) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(screen.getByRole('link', { name: 'Mã nguồn' })).toBeInTheDocument();
});
