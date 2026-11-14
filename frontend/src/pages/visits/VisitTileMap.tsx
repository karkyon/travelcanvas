/**
 * [Gate Remaining-7] FR-049 訪問の層を実際の地図(OpenStreetMap のタイル)の上に重ねる。
 * 状態は色だけでなく記号でも示す(略図と同じ記号)。候補の層(候補箱)は ☆ で出す。
 * 地図が読めない時も、下の一覧で同じ内容を読める。
 */
import React, { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { VisitCandidate, VisitItem } from '@/services/api';
import { LAYER_LABEL, LAYER_SYMBOL } from './visitModel';

const COLOR: Record<string, string> = {
  VERIFIED: '#15803d', STAYED: '#1d4ed8', VISITED: '#2563eb', PASS_THROUGH: '#9a3412', PLANNED: '#475569',
  CANDIDATE: '#a16207',
};

const Fit: React.FC<{ points: Array<[number, number]> }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    const first = points[0];
    if (points.length === 1 && first) map.setView(first, 14);
    else if (points.length > 1) map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
};

interface Props {
  items: VisitItem[];
  candidates: VisitCandidate[];
  selected: string | null;
  onSelect: (eventId: string) => void;
}

const VisitTileMap: React.FC<Props> = ({ items, candidates, selected, onSelect }) => {
  const shown = items.filter((i) => i.layer_state !== 'HIDDEN');
  const points: Array<[number, number]> = [
    ...shown.map((i) => [i.latitude, i.longitude] as [number, number]),
    ...candidates.map((c) => [c.latitude, c.longitude] as [number, number]),
  ];
  const center: [number, number] = points[0] ?? [35.681, 139.767];
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-sm" data-testid="visit-tile-map"
      role="region" aria-label={`訪問の地図(OpenStreetMap)。予定 ${shown.length}件・候補 ${candidates.length}件。内容は下の一覧と同じです`}>
      <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {shown.map((it) => (
          <React.Fragment key={it.event_id}>
            <CircleMarker center={[it.latitude, it.longitude]} radius={selected === it.event_id ? 11 : 8}
              pathOptions={{ color: COLOR[it.layer_state], fillColor: COLOR[it.layer_state], fillOpacity: 0.85,
                dashArray: it.layer_state === 'PLANNED' || it.layer_state === 'PASS_THROUGH' ? '4 3' : undefined,
                weight: selected === it.event_id ? 4 : 2 }}
              eventHandlers={{ click: () => onSelect(it.event_id) }}>
              <Tooltip>{`${LAYER_SYMBOL[it.layer_state]} ${it.title}: ${LAYER_LABEL[it.layer_state]}`}</Tooltip>
            </CircleMarker>
          </React.Fragment>
        ))}
        {candidates.map((c) => (
          <CircleMarker key={c.candidate_id} center={[c.latitude, c.longitude]} radius={7}
            pathOptions={{ color: COLOR.CANDIDATE, fillColor: '#fde68a', fillOpacity: 0.9, weight: 2, dashArray: '2 3' }}>
            <Tooltip>{`☆ ${c.title}: 候補(まだ予定に置いていない)`}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

export default VisitTileMap;
