/**
 * [Gate WishMap] 地図の印(旅程の地図と同じしずく形・番号)。旅程の地図(components/planner/PlanMap.tsx の scheduledIcon)と
 * 同じ HTML・同じクラス(.tc-pin。styles/timeline.css)で作るので、見た目がそろう。
 * 選んだ印は赤で大きく、外側に輪を付ける(旅程で選んだ予定と同じ)。
 */
import L from 'leaflet';

export const PIN_SELECTED = '#dc2626';
export const PIN_DEFAULT = '#0f6e66';

export function tripPinIcon(label: string | number, opts: { selected?: boolean; color?: string; small?: boolean } = {}): L.DivIcon {
  const selected = !!opts.selected;
  const bg = selected ? PIN_SELECTED : opts.color ?? PIN_DEFAULT;
  const size = selected ? 38 : opts.small ? 24 : 30;
  const ring = selected ? 'box-shadow:0 0 0 6px rgba(220,38,38,.25),0 2px 6px rgba(0,0,0,.35);' : 'box-shadow:0 2px 5px rgba(0,0,0,.3);';
  const text = String(label).replace(/[<>&"']/g, '');
  const font = selected ? 15 : opts.small ? 11 : 13;
  const h = Math.round(size * 1.21);
  return L.divIcon({
    html: `<div class="tc-pin${selected ? ' is-sel' : ''}" style="width:${size}px;height:${size}px;background:${bg};${ring}">`
      + `<span style="font-size:${font}px">${text}</span></div>`,
    className: '',
    iconSize: [size, h],
    iconAnchor: [size / 2, h],
    popupAnchor: [0, -h],
  });
}
