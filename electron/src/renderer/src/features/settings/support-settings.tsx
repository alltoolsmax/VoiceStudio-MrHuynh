import { GlobeIcon, MessageCircleIcon, SendIcon, UsersIcon } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { brandIcon } from '@/lib/brand';
import { ExternalLink } from '@/components/external-link';
import { LicenseSummary } from '@/components/license-gate';
import { SOURCE_CODE_URL, SUPPORT_CHANNELS } from '@shared/utils/contactLinks';
import './support-settings.css';

type ChannelIcon = ComponentType<SVGProps<SVGSVGElement>>;

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M13.5 21.5v-7.5h2.5l.4-3h-2.9V9.2c0-.9.3-1.4 1.5-1.4h1.5V5.2a19 19 0 0 0-2.2-.1c-2.2 0-3.6 1.3-3.6 3.8V11H8.4v3h2.3v7.5" />
    </svg>
  );
}

function YoutubeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" />
    </svg>
  );
}

const CHANNEL_ICONS: Record<string, ChannelIcon> = {
  facebook: FacebookIcon,
  telegram: SendIcon,
  youtube: YoutubeIcon,
  website: GlobeIcon,
  'zalo-group': UsersIcon,
  zalo: MessageCircleIcon,
};

/** Trang Hỗ trợ: chỉ hiển thị các kênh liên hệ của Mr.Huỳnh. */
export function SupportSettings() {
  const { t } = useTranslation();

  return (
    <div className="support-studio">
      <header className="support-intro">
        <div className="support-emblem" aria-hidden="true">
          <img src={brandIcon} alt="" width={100} height={100} />
        </div>
        <h1>{t('donate.hero_title')}</h1>
        <p>{t('donate.footer')}</p>
      </header>

      <LicenseSummary />

      <section className="support-contact" aria-labelledby="support-contact-heading">
        <div className="support-contact-heading">
          <h2 id="support-contact-heading">{t('contact.channels_label')}</h2>
        </div>
        <div className="support-channel-grid">
          {SUPPORT_CHANNELS.map(({ id, label, href }) => {
            const Icon = CHANNEL_ICONS[id] ?? GlobeIcon;
            return (
              <ExternalLink key={id} href={href}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </ExternalLink>
            );
          })}
        </div>
      </section>

      <p className="support-legal">
        Dựa trên VoiceStudio © Palash Debnath và cộng sự, phát hành theo giấy phép GNU AGPL-3.0.{' '}
        <ExternalLink href={SOURCE_CODE_URL} variant="link" showIcon={false}>
          Mã nguồn
        </ExternalLink>
      </p>
    </div>
  );
}
