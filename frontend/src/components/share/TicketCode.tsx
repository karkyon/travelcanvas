/**
 * [Gate Remaining-1] FR-012 チケットのコードを端末の中で描く。barcode_format が Code 128 系ならバーコード、
 * それ以外(QR・未設定)は QR。どちらも外部のサービスへ送らない。描けない時は文字で出す。
 */
import React from 'react';
import LocalQrCode from './LocalQrCode';
import { code128Svg, isLinearFormat } from './code128';

const TicketCode: React.FC<{ value: string; format?: string | null; size?: number; label: string }> = ({ value, format, size = 200, label }) => {
  if (isLinearFormat(format)) {
    const svg = code128Svg(value);
    if (svg) {
      return (
        <figure style={{ margin: 0, textAlign: 'center' }}>
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={label}
            style={{ width: '100%', maxWidth: Math.max(size, 240), height: 'auto', imageRendering: 'pixelated', background: '#fff' }} />
          <figcaption style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, letterSpacing: '.08em', color: '#0f172a' }}>{value}</figcaption>
        </figure>
      );
    }
    return <p style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{value}</p>;
  }
  return <LocalQrCode value={value} size={size} label={label} />;
};

export default TicketCode;
