import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildQrSvgDataUrl } from './qrDataUrl';

/**
 * [Gate E1] 共有URLのQRコードを端末内で作る。
 *
 * 以前は `https://api.qrserver.com/v1/create-qr-code/?data=<共有URL>` の画像を表示していた。
 * 共有URLにはそのリンクを開くための秘密のトークンが入っているため、QRを表示するたびに
 * トークンが外部のサービス(とそのアクセスログ)へ送られていた。ここでは `qrcode` で
 * SVG を作り、data URL として表示する。通信は発生しない。
 */
type Props = {
  value: string;
  /** 表示する大きさ(CSS px) */
  size?: number;
  className?: string;
  label?: string;
};

const LocalQrCode: React.FC<Props> = ({ value, size = 80, className = '', label = 'QRコード' }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      .then((svg) => {
        if (!cancelled) setSrc(buildQrSvgDataUrl(svg));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    return (
      <p className={`text-sm text-red-700 ${className}`} role="status">
        QRコードを作れませんでした。URLをコピーして共有してください。
      </p>
    );
  }
  if (!src) {
    return (
      <div
        className={`border rounded-lg bg-white ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className={`border rounded-lg bg-white ${className}`}
      data-testid="local-qr"
    />
  );
};

export default LocalQrCode;
