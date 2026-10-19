import { resetThreatScores } from './support/admin';

/**
 * [Gate A2] E2E 全体の前に、接続元の怪しさの点数(S6)・遮断を消す。
 *
 * E2E は1つの接続元から全ての spec を流すため、前の実行(再試行・続けての実行)の点数が残っていると、途中で遮断の
 * 閾値に届いて 429 になる。CI(毎回新しい機械)・omega-dev2(パッチが E2E の前に消す)でも同じ状態から始めるため、
 * ここで必ず消す。消せない(Redis に届かない)時は、backend が点数をプロセスの中だけで数えていて試験の前提が崩れて
 * いるため、ここで止める。
 */
export default function globalSetup(): void {
  resetThreatScores();
}
