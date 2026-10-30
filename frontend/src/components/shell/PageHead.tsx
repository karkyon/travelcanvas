/**
 * [Gate AppShell] ページの見出し(UI/UX モックの page-head): 小見出し(英字)・題(h1)・説明・右の操作。
 */
import React from 'react';

interface PageHeadProps {
  eyebrow: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  titleId?: string;
}

const PageHead: React.FC<PageHeadProps> = ({ eyebrow, title, sub, actions, titleId }) => (
  <div className="tc-page-head">
    <div className="min-w-0">
      <p className="tc-eyebrow">{eyebrow}</p>
      <h1 id={titleId}>{title}</h1>
      {sub && <p className="tc-subhead">{sub}</p>}
    </div>
    {actions && <div className="tc-page-actions">{actions}</div>}
  </div>
);

export default PageHead;
