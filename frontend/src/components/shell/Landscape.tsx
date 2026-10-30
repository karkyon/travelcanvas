/**
 * [Gate AppShell] モックの山並みの絵(飾り。写真の無い旅行の表紙・選んだ予定の絵に使う)。読み上げから外す。
 */
import React from 'react';

const Landscape: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 700 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className={className}>
    <rect width="700" height="260" fill="#d9e8db" />
    <circle cx="565" cy="55" r="28" fill="#f3c98b" />
    <path d="M0 205 145 88l84 73L352 49l155 155 77-90 116 107v39H0z" fill="#8eaa8e" />
    <path d="M0 230 170 141l125 70 147-79 117 92 92-80 49 41v75H0z" fill="#688c75" />
    <path d="M0 230c140-32 190-6 298 9s210-25 402 8v13H0z" fill="#c2d0b3" />
    <g fill="#466e59"><circle cx="93" cy="171" r="24" /><circle cx="633" cy="170" r="27" /><circle cx="407" cy="177" r="21" /></g>
  </svg>
);

export default Landscape;
