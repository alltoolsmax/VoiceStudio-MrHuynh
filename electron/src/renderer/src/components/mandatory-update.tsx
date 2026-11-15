import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { getBridge } from '@/components/bridge';
import { Button } from '@/components/ui/button';
import { brandIcon } from '@/lib/brand';
import type { LicenseUpdatePolicy, UpdateState } from '../../../preload/index.d';

/** Hỏi lại chính sách mỗi 6 giờ khi app mở lâu. */
const POLICY_POLL_MS = 6 * 60 * 60_000;

/**
 * Voice Studio - Mr.Huỳnh: khi trang quản trị đặt "phiên bản tối thiểu" cao hơn
 * bản đang chạy, chặn ứng dụng cho đến khi khách cập nhật. Tải bằng trình cập
 * nhật tích hợp; nếu lỗi thì mở trang tải để cài tay.
 */
export function MandatoryUpdateGate({ children }: { children: ReactNode }) {
  const api = getBridge()?.license;
  const [policy, setPolicy] = useState<LicenseUpdatePolicy | null>(null);
  useEffect(() => {
    if (!api?.updatePolicy) return;
    let alive = true;
    const load = () =>
      api
        .updatePolicy()
        .then((next) => alive && setPolicy(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, POLICY_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api]);
  if (policy?.required) return <MandatoryUpdateScreen policy={policy} />;
  return <>{children}</>;
}

function MandatoryUpdateScreen({ policy }: { policy: LicenseUpdatePolicy }) {
  const { t } = useTranslation();
  const bridge = getBridge();
  const updates = bridge?.updates;
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!updates) return;
    let alive = true;
    const off = updates.onState((next) => alive && setState(next));
    // Tự tìm và tải ngay khi màn hình hiện ra.
    void updates
      .check()
      .then((next) => {
        if (!alive) return;
        setState(next);
        if (next.status === 'available')
          return updates.download().then((s) => alive && setState(s));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, [updates]);

  const status = state?.status;
  const openDownloads = () => void bridge?.files.openExternal(policy.downloadUrl);
  const unsupported = !updates || status === 'unsupported' || status === 'error';
  return (
    <div className="app-surface flex h-full items-center justify-center overflow-y-auto bg-background p-6 text-foreground">
      <div
        role="alertdialog"
        aria-labelledby="mandatory-update-title"
        className="w-full max-w-lg space-y-5 rounded-2xl border-2 border-amber-500/60 bg-card p-7 shadow-xl"
      >
        <div className="flex items-center gap-4">
          <img src={brandIcon} alt="" width={56} height={56} />
          <div>
            <h1 id="mandatory-update-title" className="text-xl font-semibold">
              {t('activation.update_required_title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('activation.update_required_versions', {
                current: state?.currentVersion ?? '',
                min: policy.minVersion ?? '',
              })}
            </p>
          </div>
        </div>
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed">
          {policy.message || t('activation.update_required_default')}
        </p>

        {status === 'downloading' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" />
              {t('activation.update_downloading', { percent: Math.round(state?.progress ?? 0) })}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-amber-500 transition-[width]"
                style={{ width: `${Math.round(state?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {status === 'downloaded' ? (
            <Button size="lg" onClick={() => void updates?.install()}>
              <RotateCwIcon /> {t('activation.update_restart')}
            </Button>
          ) : status === 'available' || status === 'idle' ? (
            <Button
              size="lg"
              onClick={() =>
                void updates
                  ?.download()
                  .then(setState)
                  .catch(() => undefined)
              }
            >
              <DownloadIcon /> {t('activation.update_download')}
            </Button>
          ) : status === 'checking' || (!state && updates) ? (
            <Button size="lg" disabled>
              <LoaderCircleIcon className="animate-spin" /> {t('activation.update_working')}
            </Button>
          ) : null}
          <Button size="lg" variant={unsupported ? 'default' : 'outline'} onClick={openDownloads}>
            {t('activation.update_open_page')}
          </Button>
        </div>
        {status === 'error' ? (
          <p className="text-sm text-destructive">{t('activation.update_failed')}</p>
        ) : null}
      </div>
    </div>
  );
}
