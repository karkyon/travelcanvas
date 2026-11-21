/**
 * [Gate② UX P0] 確からしさの印(共通の部品)。文字(語)と 1 文字の印と形で示し、色だけに頼らない。
 * 語は既定で CERTAINTY_WORD。画面の決まった言い方(当日の「実時刻」「登録した移動」など)は word で渡す。
 */
import React from 'react';
import { CERTAINTY_LETTER, CERTAINTY_WORD, certaintyLabel, type CertaintyKind } from './certainty';

interface Props {
  kind: CertaintyKind;
  /** 画面での言い方(省くと共通の語) */
  word?: string;
  /** 取得時刻(表示用の文字。live の時に出す) */
  at?: string | null;
  /** 中に出す文(省くと語と取得時刻) */
  children?: React.ReactNode;
  testId?: string;
  className?: string;
}

const CertaintyBadge: React.FC<Props> = ({ kind, word, at, children, testId, className = '' }) => (
  <span className={`tc-cert ${className}`.trim()} data-cert={kind} data-testid={testId}
    title={certaintyLabel(kind, word, at)}>
    <i aria-hidden="true">{CERTAINTY_LETTER[kind]}</i>
    {children ?? <>{word ?? CERTAINTY_WORD[kind]}{at ? <small>{` ${at} 取得`}</small> : null}</>}
  </span>
);

export default CertaintyBadge;
