/**
 * Mua bản quyền qua máy chủ active.mrhuynh.net (thanh toán QR SePay).
 * Mọi kết nối chạy ở tiến trình chính; giao diện chỉ nhận dữ liệu đã kiểm tra.
 */
import { parseMachineCode, type PlanId } from './codec';

export const LICENSE_SERVER_URL = 'https://active.mrhuynh.net/voice_studio2_api.php';
const TIMEOUT_MS = 10_000;

export type SellablePlanId = PlanId | 'test';

export interface StorePlan {
  id: SellablePlanId;
  label: string;
  price: number;
}

export interface StoreOrder {
  code: string;
  plan: SellablePlanId;
  planLabel: string;
  amount: number;
  bank: string;
  account: string;
  holder: string;
  content: string;
  expiresAt: string;
  /** Ảnh QR dạng data: URL (giao diện không tải ảnh từ Internet). */
  qrDataUrl: string | null;
}

export type StoreError =
  | 'offline'
  | 'server_error'
  | 'already_permanent'
  | 'rate_limited'
  | 'bad_request';

export type OrderState =
  | { status: 'pending' | 'underpaid' | 'error'; paidAmount: number }
  | { status: 'paid'; key: string; paidAmount: number };

type Fetch = typeof fetch;

const PLAN_IDS = new Set(['month1', 'month3', 'year1', 'permanent', 'test']);
const ORDER_CODE = /^[A-Z]{2,5}[A-Z0-9]{8}$/;

async function getJson(
  fetchImpl: Fetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

function errorFrom(status: number, body: Record<string, unknown>): StoreError {
  const code = typeof body.error === 'string' ? body.error : '';
  if (code === 'already_permanent') return 'already_permanent';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server_error';
}

export async function fetchPlans(
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; plans: StorePlan[] } | { ok: false; error: StoreError }> {
  try {
    const { status, body } = await getJson(fetchImpl, `${LICENSE_SERVER_URL}?action=plans`);
    if (status !== 200 || !Array.isArray(body.plans))
      return { ok: false, error: errorFrom(status, body) };
    const plans = body.plans
      .filter(
        (p): p is { id: SellablePlanId; label: string; price: number } =>
          typeof p === 'object' &&
          p !== null &&
          PLAN_IDS.has((p as { id?: string }).id ?? '') &&
          typeof (p as { price?: unknown }).price === 'number',
      )
      .map(({ id, label, price }) => ({ id, label: String(label), price }));
    return { ok: true, plans };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

async function qrDataUrl(fetchImpl: Fetch, url: string): Promise<string | null> {
  try {
    if (!/^https:\/\/qr\.sepay\.vn\//.test(url)) return null;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function createOrder(
  machineCode: string,
  plan: string,
  currentKey: string | null,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; order: StoreOrder } | { ok: false; error: StoreError }> {
  if (!PLAN_IDS.has(plan) || !parseMachineCode(machineCode))
    return { ok: false, error: 'bad_request' };
  try {
    const { status, body } = await getJson(fetchImpl, `${LICENSE_SERVER_URL}?action=create_order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        machine_code: machineCode,
        plan,
        ...(currentKey ? { current_key: currentKey } : {}),
      }),
    });
    const order = body.order as Record<string, unknown> | undefined;
    if (
      status !== 200 ||
      !order ||
      typeof order.code !== 'string' ||
      !ORDER_CODE.test(order.code)
    ) {
      return { ok: false, error: errorFrom(status, body) };
    }
    return {
      ok: true,
      order: {
        code: order.code,
        plan: String(order.plan) as SellablePlanId,
        planLabel: String(order.plan_label ?? ''),
        amount: Number(order.amount),
        bank: String(order.bank ?? ''),
        account: String(order.account ?? ''),
        holder: String(order.holder ?? ''),
        content: String(order.content ?? order.code),
        expiresAt: String(order.expires_at ?? ''),
        qrDataUrl: await qrDataUrl(fetchImpl, String(order.qr_url ?? '')),
      },
    };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export async function checkOrder(
  machineCode: string,
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; state: OrderState } | { ok: false; error: StoreError }> {
  if (!ORDER_CODE.test(code)) return { ok: false, error: 'bad_request' };
  try {
    const query = new URLSearchParams({ action: 'order', code, machine_code: machineCode });
    const { status, body } = await getJson(fetchImpl, `${LICENSE_SERVER_URL}?${query}`);
    if (status !== 200) return { ok: false, error: errorFrom(status, body) };
    const paidAmount = Number(body.paid_amount ?? 0);
    if (body.status === 'paid' && typeof body.key === 'string') {
      return { ok: true, state: { status: 'paid', key: body.key, paidAmount } };
    }
    const pending =
      body.status === 'underpaid' || body.status === 'error' ? body.status : 'pending';
    return { ok: true, state: { status: pending, paidAmount } };
  } catch {
    return { ok: false, error: 'offline' };
  }
}
