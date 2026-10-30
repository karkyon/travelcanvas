/**
 * [UX-6] 知らせ(toast)の印。OS の絵文字(ℹ️ 等)に頼らず、UiIcon(lucide)で出す。.ts のファイルからも使えるよう
 * createElement で作る。最初に読む JS(store)では使わない(bundle の上限のため。store の知らせは文で伝える)。
 */
import { createElement, type ReactElement } from 'react';
import UiIcon from './UiIcon';
import { IcInfo } from './uiIcons';

/** 案内の知らせの印 */
export const infoToastIcon = (): ReactElement => createElement(UiIcon, { icon: IcInfo });
