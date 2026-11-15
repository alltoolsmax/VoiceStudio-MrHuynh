import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon, KeyRoundIcon, LoaderCircleIcon } from 'lucide-react';
import { getBridge } from '@/components/bridge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink } from '@/components/external-link';
import { brandIcon } from '@/lib/brand';
import { SUPPORT_CHANNELS } from '@shared/utils/contactLinks';
import type { LicenseStatus } from '../../../preload/index.d';

const POLL_MS = 60_000;

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

function ActivationPanel({
  status,
  onStatus,
}: {
  status: LicenseStatus;
  onStatus: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  const api = getBridge()?.license;
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.machineCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
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
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t('activation.machine_code')}</p>
        <div className="flex items-center gap-2">
          <code
            data-testid="license-machine-code"
            className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wider select-all"
          >
            {status.machineCode}
          </code>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? t('activation.copied') : t('activation.copy')}
          </Button>
        </div>
      </div>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t('activation.key_label')}
        </span>
        <Textarea
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="VSMH1-…"
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
    </form>
  );
}

function ActivationScreen({
  status,
  onStatus,
}: {
  status: Extract<LicenseStatus, { state: 'expired' }>;
  onStatus: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="app-surface flex h-full items-center justify-center overflow-y-auto bg-background p-6 text-foreground">
      <div className="w-full max-w-lg space-y-5 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <img src={brandIcon} alt="" width={56} height={56} />
          <div>
            <h1 className="text-lg font-semibold">{t('activation.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t(`activation.expired_${status.reason}`)}
            </p>
          </div>
        </div>
        <p className="text-sm">{t('activation.instructions')}</p>
        <ActivationPanel status={status} onStatus={onStatus} />
      </div>
    </div>
  );
}

function TrialBadge({
  status,
  onStatus,
}: {
  status: Extract<LicenseStatus, { state: 'trial' }>;
  onStatus: (status: LicenseStatus) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = trialRemaining(status.endsAt);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="app-no-drag fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-600 shadow-sm backdrop-blur hover:bg-amber-500/25 dark:text-amber-300"
      >
        <KeyRoundIcon className="size-3.5" aria-hidden="true" />
        {t('activation.trial_left', left)}
        <span className="underline">{t('activation.activate')}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>{t('activation.title')}</DialogTitle>
          <p className="text-sm">{t('activation.instructions')}</p>
          <ActivationPanel status={status} onStatus={onStatus} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Chặn ứng dụng khi hết hạn dùng thử và chưa có key; trong thời gian dùng thử
 * hiện huy hiệu đếm ngược kèm nút kích hoạt. Bản web (không có cầu nối
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
      {status.state === 'trial' && <TrialBadge status={status} onStatus={setStatus} />}
    </>
  );
}
