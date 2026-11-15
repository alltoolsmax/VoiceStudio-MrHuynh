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

function PaymentRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-right font-medium">
        {value}
        {copy && <CopyButton value={value} label={label} />}
      </span>
    </div>
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
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{t('activation.scan_title')}</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {order.qrDataUrl ? (
            <img
              src={order.qrDataUrl}
              alt={t('activation.scan_title')}
              className="size-52 shrink-0 rounded-lg bg-white p-1"
            />
          ) : (
            <div className="flex size-52 shrink-0 items-center justify-center rounded-lg border p-3 text-center text-xs text-muted-foreground">
              {t('activation.qr_unavailable')}
            </div>
          )}
          <div className="w-full flex-1">
            <PaymentRow label={t('activation.bank')} value={order.bank} />
            <PaymentRow label={t('activation.account')} value={order.account} copy />
            <PaymentRow label={t('activation.holder')} value={order.holder} />
            <PaymentRow label={t('activation.amount')} value={formatMoney(order.amount)} />
            <PaymentRow label={t('activation.content')} value={order.content} copy />
          </div>
        </div>
        {paidAmount > 0 && paidAmount < order.amount ? (
          <p role="alert" className="text-sm text-amber-500">
            {t('activation.underpaid', {
              paid: formatMoney(paidAmount),
              left: formatMoney(order.amount - paidAmount),
            })}
          </p>
        ) : null}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          {secondsLeft > 0
            ? `${t('activation.waiting')} ${t('activation.qr_time_left', { time: clock })}`
            : t('activation.qr_expired')}
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
        <div className="grid grid-cols-2 gap-2">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              disabled={busyPlan !== null}
              onClick={() => void buy(plan.id)}
              className="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-accent disabled:opacity-60"
            >
              <span className="text-sm font-semibold">{t(`activation.plan_${plan.id}`)}</span>
              <span className="text-lg font-bold text-primary">{formatMoney(plan.price)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {busyPlan === plan.id ? (
                  <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <QrCodeIcon className="size-3" aria-hidden="true" />
                )}
                {t('activation.buy')}
              </span>
            </button>
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
          {SUPPORT_CHANNELS.map(({ id, label, href }) => (
            <ExternalLink key={id} href={href} variant="outline">
              {label}
            </ExternalLink>
          ))}
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
      <div className="my-auto w-full max-w-xl space-y-4 rounded-xl border bg-card p-6 shadow-lg">
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
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
    <>
      {children}
      <StatusBadge status={status} onStatus={setStatus} />
    </>
  );
}
