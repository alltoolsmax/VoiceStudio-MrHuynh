import { expect, test, vi } from 'vitest';
import { checkOrder, createOrder, fetchPlans, LICENSE_SERVER_URL } from './store-client';

const MACHINE = 'VSMH-K4V4-99VS-J484-XGTN';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('talks only to active.mrhuynh.net', () => {
  expect(LICENSE_SERVER_URL).toBe('https://active.mrhuynh.net/voice_studio2_api.php');
});

test('plans keep only known plans with numeric prices', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    json({
      ok: true,
      plans: [
        { id: 'month1', label: '1 tháng', price: 55000 },
        { id: 'evil', label: 'x', price: 1 },
        { id: 'year1', label: '1 năm', price: '500000' },
      ],
    }),
  );
  expect(await fetchPlans(fetchImpl)).toEqual({
    ok: true,
    plans: [{ id: 'month1', label: '1 tháng', price: 55000 }],
  });
});

test('creating an order sends the current key for renewals and inlines the QR image', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        ok: true,
        order: {
          code: 'ACT7K4M9Q2T',
          plan: 'month3',
          plan_label: '3 tháng',
          amount: 150000,
          bank: 'BIDV',
          account: '9624788159',
          holder: 'HUYNH XUYEN SON',
          content: 'ACT7K4M9Q2T',
          qr_url: 'https://qr.sepay.vn/img?acc=9624788159&bank=BIDV&amount=150000&des=ACT7K4M9Q2T',
          expires_at: '2026-11-15T10:15:00+00:00',
        },
      }),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
  const result = await createOrder(MACHINE, 'month3', 'VSMH2-ABC', fetchImpl);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
    machine_code: MACHINE,
    plan: 'month3',
    current_key: 'VSMH2-ABC',
  });
  expect(result).toMatchObject({
    ok: true,
    order: {
      code: 'ACT7K4M9Q2T',
      amount: 150000,
      account: '9624788159',
      qrDataUrl: 'data:image/png;base64,AQID',
    },
  });
});

test('a QR URL from anywhere but qr.sepay.vn is never fetched', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        ok: true,
        order: {
          code: 'ACT7K4M9Q2T',
          plan: 'month1',
          amount: 55000,
          qr_url: 'https://evil.example/x.png',
        },
      }),
    );
  const result = await createOrder(MACHINE, 'month1', null, fetchImpl);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ ok: true, order: { qrDataUrl: null } });
});

test('errors map to friendly codes', async () => {
  expect(
    await createOrder(MACHINE, 'month1', null, vi.fn().mockRejectedValue(new Error('net'))),
  ).toEqual({
    ok: false,
    error: 'offline',
  });
  expect(
    await createOrder(
      MACHINE,
      'month1',
      null,
      vi.fn().mockResolvedValue(json({ ok: false, error: 'already_permanent' }, 409)),
    ),
  ).toEqual({ ok: false, error: 'already_permanent' });
  expect(await createOrder('VSMH-BAD', 'month1', null, vi.fn())).toEqual({
    ok: false,
    error: 'bad_request',
  });
});

test('order polling returns the key only once paid', async () => {
  const pending = vi
    .fn()
    .mockResolvedValue(json({ ok: true, status: 'underpaid', paid_amount: 30000 }));
  expect(await checkOrder(MACHINE, 'ACT7K4M9Q2T', pending)).toEqual({
    ok: true,
    state: { status: 'underpaid', paidAmount: 30000 },
  });
  const paid = vi
    .fn()
    .mockResolvedValue(json({ ok: true, status: 'paid', paid_amount: 55000, key: 'VSMH2-K' }));
  expect(await checkOrder(MACHINE, 'ACT7K4M9Q2T', paid)).toEqual({
    ok: true,
    state: { status: 'paid', key: 'VSMH2-K', paidAmount: 55000 },
  });
  expect(await checkOrder(MACHINE, '../etc', vi.fn())).toEqual({ ok: false, error: 'bad_request' });
});
