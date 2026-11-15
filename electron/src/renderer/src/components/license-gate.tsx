import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  QrCodeIcon,
} from 'lucide-react';
import { getBridge } from '@/components/bridge';
import { MandatoryUpdateGate } from '@/components/mandatory-update';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink } from '@/components/external-link';
import { brandIcon } from '@/lib/brand';
import { SUPPORT_CHANNELS } from '@shared/utils/contactLinks';
import type {
  LicenseStatus,
  LicenseStoreError,
  LicenseStoreOrder,
  LicenseStorePlan,
} from '../../../preload/index.d';

const POLL_MS = 60_000;
const ORDER_POLL_MS = 4_000;
/** Sau khi QR hết hạn vẫn hỏi tiếp một lúc: khách chuyển trễ vẫn được kích hoạt. */
const LATE_PAYMENT_MS = 30 * 60_000;
const RENEW_REMINDER_DAYS = 7;

type OnStatus = (status: LicenseStatus) => void;
type Translate = (key: string, values?: Record<string, unknown>) => string;

function useLicense() {
  const api = getBridge()?.license;
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.status());
    } catch {
      // giữ trạng thái cũ
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { api, status, setStatus };
}

/** Thời gian dùng thử còn lại, dạng giờ + phút. */
export function trialRemaining(endsAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** Số ngày (làm tròn lên) còn lại của gói có hạn. */
export function daysLeft(expiresAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
}

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

/** Mỗi gói một màu riêng để khách nhận ra ngay, cả ở bảng giá lẫn màn hình QR. */
const PLAN_THEME: Record<string, { card: string; band: string; price: string; button: string }> = {
  month1: {
    card: 'border-sky-500/50 hover:border-sky-500',
    band: 'bg-sky-500',
    price: 'text-sky-600 dark:text-sky-400',
    button: 'bg-sky-600 hover:bg-sky-700',
  },
  month3: {
    card: 'border-emerald-500/50 hover:border-emerald-500',
    band: 'bg-emerald-500',
    price: 'text-emerald-600 dark:text-emerald-400',
    button: 'bg-emerald-600 hover:bg-emerald-700',
  },
  year1: {
    card: 'border-violet-500/60 hover:border-violet-500 ring-2 ring-violet-500/30',
    band: 'bg-violet-600',
    price: 'text-violet-600 dark:text-violet-400',
    button: 'bg-violet-600 hover:bg-violet-700',
  },
  permanent: {
    card: 'border-amber-500/60 hover:border-amber-500',
    band: 'bg-gradient-to-r from-amber-500 to-orange-500',
    price: 'text-amber-600 dark:text-amber-400',
    button:
      'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600',
  },
  test: {
    card: 'border-slate-400/50 hover:border-slate-500',
    band: 'bg-slate-500',
    price: 'text-slate-600 dark:text-slate-300',
    button: 'bg-slate-600 hover:bg-slate-700',
  },
};
const PLAN_MONTHS: Record<string, number> = { month1: 1, month3: 3, year1: 12 };
const PLAN_BADGE: Record<string, string> = { year1: 'badge_popular', permanent: 'badge_best' };
/** Kênh liên hệ trong cửa sổ mua: chỉ Zalo, Facebook và Website. */
const PAYMENT_CONTACTS = ['zalo', 'facebook', 'website'];

export function planTheme(plan: string) {
  return PLAN_THEME[plan] ?? PLAN_THEME.test!;
}

/** Hạn trong key là 00:00 UTC của ngày hết hạn; hiện ngày cuối cùng còn dùng được. */
export function formatLastDay(iso: string, language: string) {
  const last = new Date(Date.parse(iso) - 1);
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(last);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`${t('activation.copy')} ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {copied ? t('activation.copied') : t('activation.copy')}
    </Button>
  );
}

function MachineCode({ status }: { status: LicenseStatus }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{t('activation.machine_code')}</p>
      <div className="flex items-center gap-2">
        <code
          data-testid="license-machine-code"
          className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wider select-all"
        >
          {status.machineCode}
        </code>
        <CopyButton value={status.machineCode} label={t('activation.machine_code')} />
      </div>
    </div>
  );
}

function KeyEntry({ onStatus }: { onStatus: OnStatus }) {
  const { t } = useTranslation();
  const api = getBridge()?.license;
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || !key.trim()) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.activate(key.trim());
      if (result.ok) {
        setDone(true);
        onStatus(result.status);
      } else {
        setError(t(`activation.error_${result.reason}`));
      }
    } catch {
      setError(t('activation.error_signature'));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('activation.key_instructions')}</p>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t('activation.key_label')}
        </span>
        <Textarea
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="VSMH2-…"
          rows={3}
          spellCheck={false}
          className="font-mono text-xs"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-emerald-500">
          {t('activation.success')}
        </p>
      )}
      <Button type="submit" disabled={pending || !key.trim()}>
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        ) : (
          <KeyRoundIcon aria-hidden="true" />
        )}
        {t('activation.activate')}
      </Button>
    </form>
  );
}

function PaymentRow({
  label,
  value,
  copy,
  strong,
}: {
  label: string;
  value: string;
  copy?: boolean;
  strong?: string;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b py-2 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">
        <span
          className={`break-all font-semibold ${strong ?? 'text-base'}`}
          data-testid={`pay-${label}`}
        >
          {value}
        </span>
        {copy && <CopyButton value={value} label={label} />}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  monthPrice,
  busy,
  disabled,
  onBuy,
}: {
  plan: LicenseStorePlan;
  monthPrice: number | null;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const theme = planTheme(plan.id);
  const months = PLAN_MONTHS[plan.id];
  const perMonth = months ? Math.round(plan.price / months) : null;
  const saving =
    months && months > 1 && monthPrice
      ? Math.round((1 - plan.price / (monthPrice * months)) * 100)
      : 0;
  const badge = PLAN_BADGE[plan.id];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onBuy}
      data-plan={plan.id}
      className={`group relative flex flex-col overflow-hidden rounded-xl border-2 bg-card text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-60 ${theme.card}`}
    >
      <span className={`px-2 py-2 text-base font-bold text-white ${theme.band}`}>
        {t(`activation.plan_${plan.id}`)}
      </span>
      {badge ? (
        <span className="absolute top-10 right-1/2 translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-background uppercase">
          {t(`activation.${badge}`)}
        </span>
      ) : null}
      <span className="flex flex-1 flex-col items-center gap-1 px-2 pt-6 pb-3">
        <span className={`text-2xl font-extrabold tabular-nums ${theme.price}`}>
          {formatMoney(plan.price)}
        </span>
        <span className="min-h-4 text-xs text-muted-foreground">
          {plan.id === 'permanent'
            ? t('activation.pay_once')
            : perMonth
              ? t('activation.per_month', { price: formatMoney(perMonth) })
              : ''}
        </span>
        <span className="min-h-5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          {saving > 0 ? t('activation.save_percent', { percent: saving }) : ''}
        </span>
      </span>
      <span
        className={`mx-3 mb-3 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-white ${theme.button}`}
      >
        {busy ? (
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <QrCodeIcon className="size-4" aria-hidden="true" />
        )}
        {t('activation.buy')}
      </span>
    </button>
  );
}

function PurchasePanel({ onStatus }: { onStatus: OnStatus }) {
  const { t } = useTranslation();
  const api = getBridge()?.license;
  const [plans, setPlans] = useState<LicenseStorePlan[] | null>(null);
  const [error, setError] = useState<LicenseStoreError | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [order, setOrder] = useState<LicenseStoreOrder | null>(null);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paidPlan, setPaidPlan] = useState<string | null>(null);
  const [, tick] = useState(0);

  const loadPlans = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const result = await api.plans();
      if (result.ok) setPlans(result.plans);
      else setError(result.error);
    } catch {
      setError('offline');
    }
  }, [api]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  // Hỏi máy chủ vài giây một lần cho đến khi đơn được thanh toán.
  useEffect(() => {
    if (!api || !order) return;
    const giveUpAt = Date.parse(order.expiresAt) + LATE_PAYMENT_MS;
    let stopped = false;
    const poll = async () => {
      if (stopped || Date.now() > giveUpAt) return;
      const result = await api.checkOrder(order.code).catch(() => null);
      tick((n) => n + 1);
      if (!result || !result.ok || stopped) return;
      if (result.state.status === 'paid') {
        if ('activation' in result && result.activation.ok) {
          stopped = true;
          setPaidPlan(order.plan === 'test' ? 'month1' : order.plan);
          onStatus(result.activation.status);
        }
        return;
      }
      setPaidAmount(result.state.paidAmount);
    };
    const timer = window.setInterval(() => void poll(), ORDER_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, order, onStatus]);

  const buy = async (plan: string) => {
    if (!api) return;
    setBusyPlan(plan);
    setError(null);
    try {
      const result = await api.createOrder(plan);
      if (result.ok) {
        setOrder(result.order);
        setPaidAmount(0);
      } else {
        setError(result.error);
      }
    } catch {
      setError('offline');
    } finally {
      setBusyPlan(null);
    }
  };

  if (paidPlan) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2Icon className="size-12 text-emerald-500" aria-hidden="true" />
        <p className="text-base font-semibold">
          {t('activation.paid_success', { plan: t(`activation.plan_${paidPlan}`) })}
        </p>
      </div>
    );
  }

  if (order) {
    const secondsLeft = Math.max(0, Math.floor((Date.parse(order.expiresAt) - Date.now()) / 1000));
    const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
    const theme = planTheme(order.plan);
    return (
      <div className="flex flex-col gap-4">
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-white ${theme.band}`}
        >
          <span className="text-base font-bold">
            {t('activation.order_plan', { plan: t(`activation.plan_${order.plan}`) })}
          </span>
          <span className="text-2xl font-extrabold tabular-nums">{formatMoney(order.amount)}</span>
        </div>
        <div className="grid items-start gap-5 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            {order.qrDataUrl ? (
              <img
                src={order.qrDataUrl}
                alt={t('activation.scan_title')}
                className="size-72 rounded-xl border-4 border-white bg-white shadow-md"
              />
            ) : (
              <div className="flex size-72 items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-sm text-muted-foreground">
                {t('activation.qr_unavailable')}
              </div>
            )}
            <p className="max-w-72 text-center text-sm font-medium">{t('activation.scan_title')}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-xl border bg-muted/30 px-4">
              <PaymentRow label={t('activation.bank')} value={order.bank} />
              <PaymentRow label={t('activation.account')} value={order.account} copy />
              <PaymentRow label={t('activation.holder')} value={order.holder} />
              <PaymentRow
                label={t('activation.amount')}
                value={formatMoney(order.amount)}
                strong={`text-xl ${theme.price}`}
              />
              <PaymentRow
                label={t('activation.content')}
                value={order.content}
                copy
                strong="font-mono text-lg tracking-wider text-red-600 dark:text-red-400"
              />
            </div>
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {t('activation.content_warning')}
            </p>
            {paidAmount > 0 && paidAmount < order.amount ? (
              <p
                role="alert"
                className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600"
              >
                {t('activation.underpaid', {
                  paid: formatMoney(paidAmount),
                  left: formatMoney(order.amount - paidAmount),
                })}
              </p>
            ) : null}
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon
                className="mt-0.5 size-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
              <span>
                {secondsLeft > 0
                  ? `${t('activation.waiting')} ${t('activation.qr_time_left', { time: clock })}`
                  : t('activation.qr_expired')}
              </span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOrder(null)}>
                {t('activation.back')}
              </Button>
              {secondsLeft === 0 && (
                <Button type="button" onClick={() => void buy(order.plan)}>
                  {t('activation.new_code')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('activation.renewal_note')}</p>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-sm text-destructive"
        >
          <span>{t(`activation.store_error_${error}`)}</span>
          {!plans && (
            <Button type="button" size="sm" variant="outline" onClick={() => void loadPlans()}>
              {t('activation.retry')}
            </Button>
          )}
        </div>
      )}
      {!plans && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          {t('activation.plans_loading')}
        </p>
      )}
      {plans && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, plans.length)}, minmax(0, 1fr))` }}
        >
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              monthPrice={plans.find((p) => p.id === 'month1')?.price ?? null}
              busy={busyPlan === plan.id}
              disabled={busyPlan !== null}
              onBuy={() => void buy(plan.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Mua gói (QR) hoặc nhập key, kèm mã máy và kênh liên hệ. */
export function LicensePanel({
  status,
  onStatus,
  initialTab = 'buy',
}: {
  status: LicenseStatus;
  onStatus: OnStatus;
  initialTab?: 'buy' | 'key';
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(['buy', 'key'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === id ? 'bg-background shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t(`activation.tab_${id}`)}
          </button>
        ))}
      </div>
      {tab === 'buy' ? <PurchasePanel onStatus={onStatus} /> : <KeyEntry onStatus={onStatus} />}
      <MachineCode status={status} />
      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">{t('activation.contact')}</p>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORT_CHANNELS.filter(({ id }) => PAYMENT_CONTACTS.includes(id)).map(
            ({ id, label, href }) => (
              <ExternalLink key={id} href={href} variant="outline">
                {label}
              </ExternalLink>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function expiredMessage(
  status: Extract<LicenseStatus, { state: 'expired' }>,
  t: Translate,
  language: string,
) {
  if (status.reason === 'license_ended' && status.plan && status.expiredAt) {
    return t('activation.expired_license_ended', {
      plan: t(`activation.plan_${status.plan}`),
      date: formatLastDay(status.expiredAt, language),
    });
  }
  return t(`activation.expired_${status.reason}`);
}

function ActivationScreen({
  status,
  onStatus,
}: {
  status: Extract<LicenseStatus, { state: 'expired' }>;
  onStatus: OnStatus;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="app-surface flex h-full items-start justify-center overflow-y-auto bg-background p-6 text-foreground">
      <div className="my-auto w-full max-w-4xl space-y-4 rounded-2xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <img src={brandIcon} alt="" width={56} height={56} />
          <div>
            <h1 className="text-lg font-semibold">{t('activation.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {expiredMessage(status, t, i18n.language)}
            </p>
          </div>
        </div>
        <LicensePanel status={status} onStatus={onStatus} />
      </div>
    </div>
  );
}

function LicenseDialog({
  open,
  onOpenChange,
  status,
  onStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: LicenseStatus;
  onStatus: OnStatus;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(56rem,calc(100vw-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogTitle>{t('activation.buy_title')}</DialogTitle>
        <LicensePanel status={status} onStatus={onStatus} />
      </DialogContent>
    </Dialog>
  );
}

/** Huy hiệu góc màn hình: thời gian dùng thử, hoặc nhắc gia hạn khi gói sắp hết. */
function StatusBadge({ status, onStatus }: { status: LicenseStatus; onStatus: OnStatus }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  let text: string | null = null;
  if (status.state === 'trial') {
    text = t('activation.trial_left', trialRemaining(status.endsAt));
  } else if (status.state === 'licensed' && status.expiresAt) {
    const days = daysLeft(status.expiresAt);
    if (days <= RENEW_REMINDER_DAYS) text = t('activation.renew_badge', { days });
  }
  if (!text) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="app-no-drag fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-600 shadow-sm backdrop-blur hover:bg-amber-500/25 dark:text-amber-300"
      >
        <KeyRoundIcon className="size-3.5" aria-hidden="true" />
        {text}
      </button>
      <LicenseDialog open={open} onOpenChange={setOpen} status={status} onStatus={onStatus} />
    </>
  );
}

/** Thẻ bản quyền cho trang Hỗ trợ: gói hiện tại, hạn dùng, nút mua / gia hạn. */
export function LicenseSummary() {
  const { t, i18n } = useTranslation();
  const { api, status, setStatus } = useLicense();
  const [open, setOpen] = useState(false);
  if (!api || !status) return null;
  let line: string;
  if (status.state === 'trial') line = t('activation.trial_left', trialRemaining(status.endsAt));
  else if (status.state === 'expired') line = expiredMessage(status, t, i18n.language);
  else if (!status.expiresAt) line = t('activation.licensed_permanent');
  else
    line = t('activation.licensed_until', {
      plan: t(`activation.plan_${status.plan}`),
      date: formatLastDay(status.expiresAt, i18n.language),
    });
  const permanent = status.state === 'licensed' && !status.expiresAt;
  return (
    <section className="support-license" aria-labelledby="support-license-heading">
      <h2 id="support-license-heading">{t('activation.license_section')}</h2>
      <p data-testid="license-summary-line">{line}</p>
      <p className="support-license-machine">
        {t('activation.machine_code')}: <code>{status.machineCode}</code>
      </p>
      {!permanent && (
        <Button type="button" onClick={() => setOpen(true)}>
          <QrCodeIcon aria-hidden="true" />
          {status.state === 'licensed' ? t('activation.renew') : t('activation.buy_title')}
        </Button>
      )}
      <LicenseDialog open={open} onOpenChange={setOpen} status={status} onStatus={setStatus} />
    </section>
  );
}

/**
 * Chặn ứng dụng khi hết hạn dùng thử / hết hạn gói và chưa có key; hiện huy
 * hiệu khi đang dùng thử và khi gói sắp hết hạn. Bản web (không có cầu nối
 * Electron) không bị chặn.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const { api, status, setStatus } = useLicense();
  if (!api) return <>{children}</>;
  if (!status) return null;
  if (status.state === 'expired') return <ActivationScreen status={status} onStatus={setStatus} />;
  return (
    <MandatoryUpdateGate>
      {children}
      <StatusBadge status={status} onStatus={setStatus} />
    </MandatoryUpdateGate>
  );
}
