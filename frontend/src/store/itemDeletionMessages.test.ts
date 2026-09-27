/**
 * [Gate B-013] 個別削除の利用者向け文言。予約・文書の本体が残ること、区間等を一緒に
 * 削除したこと、「元に戻す」で戻せることを正確に伝える。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import {
  conflictCode, describeCollaboratorRemoval, describeItemDeletion, describeRouteOptionDeletion,
} from './itemDeletionMessages';

const none = { reservations_unlinked: 0, document_links_removed: 0, segments_removed: 0, route_options_removed: 0, segments_unlinked: 0 };

describe('describeItemDeletion', () => {
  it('何も外していなければ案内しない', () => {
    expect(describeItemDeletion('event', none)).toBeNull();
    expect(describeItemDeletion('day', undefined)).toBeNull();
  });

  it('予約の紐付けだけを外した場合は、予約が残ることを伝える', () => {
    expect(describeItemDeletion('event', { ...none, reservations_unlinked: 1 })).toBe(
      '予定を削除しました。予約1件との紐付けを外しました(予約の内容は残っています)。「元に戻す」でまとめて復元できます。'
    );
  });

  it('実応答(予約・文書・区間・経路候補)をまとめて伝える', () => {
    expect(describeItemDeletion('day', fx.event_deleted_detached.detached)).toBe(
      '日程を削除しました。予約1件・文書1件との紐付けを外しました(予約・文書の内容は残っています)。' +
        '移動区間1件・経路候補1件も削除しました。「元に戻す」でまとめて復元できます。'
    );
  });

  it('経路候補の削除で区間を残した場合もその旨を伝える', () => {
    expect(describeItemDeletion('event', { ...none, segments_unlinked: 2 })).toContain('移動区間2件は残し');
    expect(describeRouteOptionDeletion(1)).toBe('経路候補を削除しました。この候補から採用した移動区間1件は残っています。');
    expect(describeRouteOptionDeletion(0)).toBe('経路候補を削除しました。');
  });
});

describe('describeCollaboratorRemoval', () => {
  it('割当を外した件数と、チケット・参加者が残ることを伝える', () => {
    expect(describeCollaboratorRemoval(fx.collaborator_removed)).toBe(
      'コラボレーターを削除しました。チケット担当1件の割当を外しました(チケット・参加者の情報は残っています)'
    );
    expect(describeCollaboratorRemoval({ success: true, detached: { ticket_holders: 0, participants: 0 } }))
      .toBe('コラボレーターを削除しました');
    expect(describeCollaboratorRemoval(undefined)).toBe('コラボレーターを削除しました');
  });
});

describe('conflictCode', () => {
  it('409の構造化detailだけからcodeを取り出す', () => {
    expect(conflictCode({ response: { status: 409, data: fx.event_delete_locked_409 } })).toBe('locked_relation');
    expect(conflictCode({ response: { status: 409, data: fx.undo_conflict_409 } })).toBe('undo_conflict');
    expect(conflictCode({ response: { status: 409, data: { detail: 'revision mismatch' } } })).toBeNull();
    expect(conflictCode({ response: { status: 422, data: fx.event_delete_locked_409 } })).toBeNull();
    expect(conflictCode(new Error('network'))).toBeNull();
    expect(conflictCode(null)).toBeNull();
  });
});
