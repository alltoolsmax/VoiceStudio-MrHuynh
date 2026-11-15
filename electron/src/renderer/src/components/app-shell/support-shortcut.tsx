import { Link } from '@tanstack/react-router';
import { LifeBuoyIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import './support-shortcut.css';

/** Nút "Hỗ trợ" trên thanh tiêu đề, mở trang kênh hỗ trợ của Mr.Huỳnh. */
export function SupportShortcut() {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/settings/support"
              aria-label={t('donate.title')}
              className="support-shortcut app-no-drag flex items-center gap-1 px-1.5 focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          <LifeBuoyIcon aria-hidden="true" className="size-3.5" />
          <span className="hidden text-xs font-medium sm:inline">{t('donate.title')}</span>
        </TooltipTrigger>
        <TooltipContent surface="theme" side="bottom">
          {t('contact.channels_label')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
