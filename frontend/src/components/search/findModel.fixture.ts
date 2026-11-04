/** [Gate SpotFind] 試験用: GPS の入った最小の JPEG(Exif)を作る */
export function jpegWithGps(lat: number, lon: number, little = true): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24]
    : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const dms = (x: number) => { const a = Math.abs(x); const d = Math.floor(a); const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 1000); return [d, 1, m, 1, s, 1000]; };
  // header
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  // IFD0 at 8: 1 entry (GPS pointer)
  tiff.push(...u16(1), ...u16(0x8825), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  // GPS IFD at 26: 4 entries
  const gpsStart = 26;
  const dataStart = gpsStart + 2 + 4 * 12 + 4;
  tiff.push(...u16(4));
  tiff.push(...u16(1), ...u16(2), ...u32(2), lat >= 0 ? 0x4e : 0x53, 0, 0, 0);
  tiff.push(...u16(2), ...u16(5), ...u32(3), ...u32(dataStart));
  tiff.push(...u16(3), ...u16(2), ...u32(2), lon >= 0 ? 0x45 : 0x57, 0, 0, 0);
  tiff.push(...u16(4), ...u16(5), ...u32(3), ...u32(dataStart + 24));
  tiff.push(...u32(0));
  for (const v of [...dms(lat), ...dms(lon)]) tiff.push(...u32(v));
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, ((exif.length + 2) >> 8) & 255, (exif.length + 2) & 255, ...exif];
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]).buffer;
}
