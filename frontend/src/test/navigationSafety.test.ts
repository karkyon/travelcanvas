/**
 * [Gate G3] DEP-02 画面の移動先・外へ開く URL の静的な検査。
 *
 * 移動(navigate・<Link to>・<Navigate to>)・リンク(href)・window.open・location の書き換えの引数が、
 * 固定のアプリ内パス(`/` で始まる文字列・テンプレート)か、safeInternalPath / safeExternalUrl / safeTelHref
 * を通した値であることを、src の全ファイル(試験を除く)で確かめる。新しく変数をそのまま渡す箇所を足すと落ちる
 * (外部の値で外部のサイトへ飛ぶ・javascript: が動くことを防ぐ)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname, '..');
const SAFE_CALLS = new Set(['safeInternalPath', 'safeExternalUrl', 'safeTelHref']);

/** 固定の配列(画面の上のメニュー)から作った値など、静的に安全と確認した式。`ファイル::式` */
const ALLOW = new Set([
  'components/Header.tsx::item.path',
  'components/layout/Header.tsx::item.href',
  'components/common/Button.tsx::isDisabled ? undefined : href',
  'components/location/RecordingIndicator.tsx::trackPath',
  // [Gate G9] ダッシュボードの「スポット・地図」への入口(固定の配列 OTHER_LINKS)
  'pages/DashboardPage.tsx::to',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test' || name === '__snapshots__') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

function isFixedInternal(text: string): boolean {
  return text.startsWith('/') && !text.startsWith('//') && !text.includes('\\');
}

function safeExpr(node: ts.Expression, sf: ts.SourceFile, file: string, kind: 'nav' | 'href'): boolean {
  if (ALLOW.has(`${file}::${node.getText(sf)}`)) return true;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return safeExpr(node.expression, sf, file, kind);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const t = node.text;
    return isFixedInternal(t) || (kind === 'href' && (t.startsWith('#') || t.startsWith('mailto:')));
  }
  if (ts.isTemplateExpression(node)) {
    const head = node.head.text;
    return isFixedInternal(head) || (kind === 'href' && head.startsWith('#'));
  }
  if (ts.isNumericLiteral(node) || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))) {
    return kind === 'nav'; // navigate(-1)
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(node) && node.text === 'undefined')) return true;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SAFE_CALLS.has(node.expression.text)) return true;
  // 端末の中で作ったファイル(blob:)
  if (kind === 'href' && ts.isCallExpression(node) && node.expression.getText(sf) === 'URL.createObjectURL') return true;
  if (ts.isConditionalExpression(node)) {
    return safeExpr(node.whenTrue, sf, file, kind) && safeExpr(node.whenFalse, sf, file, kind);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return safeExpr(node.left, sf, file, kind) && safeExpr(node.right, sf, file, kind);
  }
  const text = node.getText(sf);
  if (ALLOW.has(`${file}::${text}`)) return true;
  if (ts.isIdentifier(node)) {
    // 同じファイルで `const 名前 = <安全な式>` と決めた変数
    let ok = false;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === node.text && n.initializer
        && (n.parent.flags & ts.NodeFlags.Const)) {
        ok = ok || safeExpr(n.initializer, sf, file, kind);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return ok;
  }
  return false;
}

interface Finding { file: string; line: number; what: string; expr: string }

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path).split('\\').join('/');
    const text = readFileSync(path, 'utf8');
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const report = (node: ts.Node, what: string, expr: ts.Expression, kind: 'nav' | 'href') => {
      if (!safeExpr(expr, sf, file, kind)) {
        findings.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, what,
          expr: expr.getText(sf) });
      }
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression.getText(sf);
        if (callee === 'navigate') report(node, 'navigate', node.arguments[0]!, 'nav');
        if (callee === 'window.open' || callee === 'location.assign' || callee === 'window.location.assign'
          || callee === 'location.replace' || callee === 'window.location.replace') {
          report(node, callee, node.arguments[0]!, 'href');
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = node.left.getText(sf);
        // 画面の移動(window.location・document.location の書き換え、リンクの要素の href)。同じ名前の変数(location = {...})は対象外
        if (/^(window\.|document\.)location(\.href)?$/.test(left) || /\.href$/.test(left)) {
          report(node, `${left} =`, node.right, 'href');
        }
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const name = node.name.getText(sf);
        if (name === 'to') report(node, 'to', node.initializer.expression, 'nav');
        if (name === 'href') report(node, 'href', node.initializer.expression, 'href');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

describe('画面の移動先・外へ開く URL (Gate G3 DEP-02)', () => {
  it('全ての移動・リンクが固定のアプリ内パスか、安全化の関数を通した値', () => {
    const bad = scan().map((f) => `${f.file}:${f.line} ${f.what} ← ${f.expr}`);
    expect(bad).toEqual([]);
  }, 60_000); // 全ての画面のファイルを構文解析する(負荷の高い機械では既定の 10 秒を越えることがある)

  it('検査そのものが変数の直渡しを見つける(自己試験)', () => {
    const src = "const go = (link: string) => { navigate(link); window.open(url); };\n"
      + "const a = <a href={user.website}>x</a>;\nconst ok = <a href={safeExternalUrl(u) ?? undefined}>y</a>;\n";
    const sf = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.arguments[0] && !safeExpr(node.arguments[0], sf, 'x.tsx', 'nav')) {
        found.push(node.expression.getText(sf));
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression
        && !safeExpr(node.initializer.expression, sf, 'x.tsx', 'href')) {
        found.push(node.initializer.expression.getText(sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(found).toContain('navigate');
    expect(found).toContain('window.open');
    expect(found).toContain('user.website');
    expect(found).not.toContain('safeExternalUrl(u) ?? undefined');
  });
});
