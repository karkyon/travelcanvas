/**
 * [Gate SpotLinks] 予定の場所の電話と URL のリンク。電話は tel: のリンク(スマホでは押すと電話をかけられる)、
 * URL は新しいタブで開く(http/https だけ。safeExternalUrl を通す)。
 */
import React from 'react';
import { ExternalLink, Phone } from 'lucide-react';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import type { EventUrl } from '@/types';
import { linkText } from './spotLinksModel';

interface Props {
  phone?: string | null;
  urls?: EventUrl[] | null;
  className?: string;
}

const SpotLinks: React.FC<Props> = ({ phone, urls, className = '' }) => {
  const tel = phone ? safeTelHref(phone) : null;
  const links = (urls ?? []).filter((u) => safeExternalUrl(u.url));
  if (!tel && links.length === 0) return null;
  return (
    <ul className={`tc-spot-links ${className}`.trim()} aria-label="場所の連絡先とリンク" data-testid="spot-links">
      {tel && (
        <li>
          <a href={safeTelHref(phone) ?? undefined} className="tc-focus-ring" aria-label={`電話をかける ${phone}`}>
            <Phone size={14} aria-hidden="true" />{phone}
          </a>
        </li>
      )}
      {links.map((u) => (
        <li key={u.url}>
          <a href={safeExternalUrl(u.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring">
            <ExternalLink size={14} aria-hidden="true" />{linkText(u)}
            <span className="sr-only">(新しいタブで開く)</span>
          </a>
        </li>
      ))}
    </ul>
  );
};

export default SpotLinks;
