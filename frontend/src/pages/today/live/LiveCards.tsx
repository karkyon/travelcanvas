/**
 * [Gate TDay] 次の場所の画像が無い時の絵(場所の種類の模様)。架空の写真は出さない。
 */
import React from 'react';

export const TeaserArt: React.FC<{ type: string }> = ({ type }) => (
  <svg className="tc-teaser__art" viewBox="0 0 400 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="400" height="168" fill="var(--tc-mist-200)" />
    <circle cx="320" cy="44" r="22" fill="var(--tc-sand-300)" />
    <path d="M0 108 Q100 86 200 102 T400 96 V168 H0Z" fill="var(--tc-accent-soft)" />
    <path d="M0 128 Q200 116 400 126 V168 H0Z" fill="var(--tc-mist-50)" />
    {type === 'dining' && <ellipse cx="200" cy="118" rx="54" ry="18" fill="var(--tc-sand-100)" />}
    {type === 'sightseeing' && <path d="M160 104 L200 76 L240 104Z" fill="var(--tc-sand-300)" />}
  </svg>
);
