/**
 * [Gate M9-FE-C2b-2] 実backend応答の契約テスト。
 *
 * __fixtures__/backendContractResponses.json は、sandboxの実backend(FastAPI +
 * PostgreSQL 16)へTestClientで予約・チケット・移動区間・経路・取込・文書・当日モードの
 * 各APIを実際に呼び出して採取した応答である。runtime decoderがこれらを受理すること
 * (=backendとfrontendの型契約が一致していること)を固定する。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { arrayOf, decodeResponse, ApiDecodeError, type Decoder } from './decode';
import {
  adoptRouteOptionResponse, documentLink, downloadUrlResult, extractionCandidate, importJob, importJobDetail,
  reservation, reservationEventLink, reservationParticipant, reservationRevealResult, routeLeg, routeOption,
  ticket, ticketRevealResult, todayResponse, travelDocument, travelSegment,
} from './decoders';
import { api } from './index';
import type { MinimalHttpClient } from './types';

const CASES: Array<[keyof typeof fx, Decoder<unknown>]> = [
  ['reservation', reservation],
  ['reservation_minimal', reservation],
  ['reservation_updated', reservation],
  ['reservation_list', arrayOf(reservation)],
  ['reservation_reveal', reservationRevealResult],
  ['participant', reservationParticipant],
  ['participant_list', arrayOf(reservationParticipant)],
  ['event_link', reservationEventLink],
  ['event_link_list', arrayOf(reservationEventLink)],
  ['ticket', ticket],
  ['ticket_minimal', ticket],
  ['ticket_list', arrayOf(ticket)],
  ['ticket_reveal', ticketRevealResult],
  ['segment', travelSegment],
  ['segment_updated', travelSegment],
  ['segment_list', arrayOf(travelSegment)],
  ['route_option', routeOption],
  ['route_option_minimal', routeOption],
  ['route_option_list', arrayOf(routeOption)],
  ['route_leg', routeLeg],
  ['route_adopt', adoptRouteOptionResponse],
  ['import_job', importJob],
  ['import_job_confirmed', importJob],
  ['import_job_list', arrayOf(importJob)],
  ['import_job_detail', importJobDetail],
  ['import_candidate', extractionCandidate],
  ['import_candidate_accepted', extractionCandidate],
  ['document', travelDocument],
  ['document_list', arrayOf(travelDocument)],
  ['document_link', documentLink],
  ['document_link_list', arrayOf(documentLink)],
  ['document_download_url', downloadUrlResult],
  ['today', todayResponse],
];

describe('実backend応答の契約 (Gate M9-FE-C2b-2)', () => {
  it('採取した全応答を対応するdecoderが受理する', () => {
    const fixtureKeys = Object.keys(fx).filter((k) => k !== '_meta').sort();
    expect(CASES.map(([k]) => k).sort()).toEqual(fixtureKeys);
    for (const [key, decoder] of CASES) {
      expect(() => decodeResponse(fx[key], decoder, key)).not.toThrow();
    }
  });

  it('decoderは値を変えず、decoder未宣言の項目(例: segment.route_option_id)も保持する', () => {
    expect(decodeResponse(fx.segment, travelSegment, 'segment')).toEqual(fx.segment);
    expect('route_option_id' in decodeResponse(fx.segment, travelSegment, 'segment')).toBe(true);
    expect(decodeResponse(fx.route_option, routeOption, 'route_option')).toEqual(fx.route_option);
  });

  it('列挙値がbackendの許容集合外なら拒否する', () => {
    expect(() => decodeResponse({ ...fx.segment, mode: 'teleport' }, travelSegment, 'x')).toThrow(/\$\.mode/);
    expect(() => decodeResponse({ ...fx.document, classification: 'secret' }, travelDocument, 'x')).toThrow(
      ApiDecodeError
    );
    expect(() => decodeResponse({ ...fx.ticket, share_policy: 'everyone' }, ticket, 'x')).toThrow(
      /\$\.share_policy/
    );
    const badLeg = { ...fx.route_option, legs: [{ ...fx.route_leg, realtime_status: 'late' }] };
    expect(() => decodeResponse(badLeg, routeOption, 'x')).toThrow(/\$\.legs\[0\]\.realtime_status/);
  });

  it('取込詳細の候補一覧も要素ごとに検証する', () => {
    const bad = { ...fx.import_job_detail, candidates: [{ ...fx.import_candidate, confidence: 'high' }] };
    expect(() => decodeResponse(bad, importJobDetail, 'x')).toThrow(/\$\.candidates\[0\]\.confidence/);
  });
});

function respondWith(data: unknown): void {
  const reply = async () => ({ data });
  const client: Partial<MinimalHttpClient> = {
    get: reply, post: reply, put: reply, patch: reply, delete: reply, request: reply,
  };
  api.setHttpClientForTesting(client);
}

describe('APIクライアント経由の検証 (Gate M9-FE-C2b-2)', () => {
  it('実応答はそのまま返り、形式不正は例外になる', async () => {
    respondWith(fx.reservation_list);
    await expect(api.getReservations('p')).resolves.toEqual(fx.reservation_list);
    respondWith(fx.reservation_updated);
    await expect(api.updateReservation('p', 'r', { notes: 'x' }, 1)).resolves.toEqual(fx.reservation_updated);
    respondWith([{ ...fx.reservation, has_pin: 'yes' }]);
    await expect(api.getReservations('p')).rejects.toThrow(/\$\[0\]\.has_pin/);

    respondWith(fx.ticket_list);
    await expect(api.getTickets('p', 'r')).resolves.toEqual(fx.ticket_list);
    respondWith(fx.segment_list);
    await expect(api.getSegments('p')).resolves.toEqual(fx.segment_list);
    respondWith(fx.route_adopt);
    await expect(api.adoptRouteOption('p', 'o', 1)).resolves.toEqual(fx.route_adopt);
    respondWith(fx.import_job_detail);
    await expect(api.getImportJob('p', 'j')).resolves.toEqual(fx.import_job_detail);
    respondWith(fx.document_list);
    await expect(api.getDocuments('p')).resolves.toEqual(fx.document_list);
    respondWith(fx.document_link_list);
    await expect(api.getDocumentLinks('p', 'd')).resolves.toEqual(fx.document_link_list);

    respondWith({ detail: 'not a list' });
    await expect(api.getDocuments('p')).rejects.toBeInstanceOf(ApiDecodeError);
  });
});
