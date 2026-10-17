/** [Gate E1] qrcode が作った SVG を、通信の発生しない data URL にする */
export function buildQrSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
