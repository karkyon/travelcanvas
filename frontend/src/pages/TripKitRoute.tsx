/**
 * [Gate TripKit] 旅行箱の概要(/kit)と旅行箱を検索(/kit/search)を 1 つの塊で読む。
 * 2 つを別々に後から読むと、最初に読む JS(塊の一覧)が増えて上限(430 kB)を超えるため。
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import TripKitPage from './TripKitPage';
import TripKitSearchPage from './TripKitSearchPage';

const TripKitRoute: React.FC = () => (
  /\/kit\/search\/?$/.test(useLocation().pathname) ? <TripKitSearchPage /> : <TripKitPage />
);

export default TripKitRoute;
