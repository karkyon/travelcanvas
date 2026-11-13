/**
 * [Gate TDay-Mock] 旅の当日で開く画面(後から読む。当日の画面の最初の読み込みを重くしない)。
 */
import React from 'react';
import type { TodayCtx, TodayScreen } from './todayCtx';
import type { useCrew } from './todayHelpers';
import { CheckinScreen, GoNowScreen, HomeRouteScreen, PlaceScreen, TransitScreen } from './ScreensMove';
import { MapScreen, MemoScreen, StampScreen, TabichoScreen, TimelineScreen } from './ScreensBook';
import {
  CrewScreen, DelayScreen, DetourScreen, HelpScreen, PhotoQrScreen, PrepareScreen, RainScreen, SettingsScreen, TicketScreen,
} from './ScreensHelp';

const TodayScreens: React.FC<{
  ctx: TodayCtx; screen: TodayScreen; arg: string | null; crew: ReturnType<typeof useCrew>; onPrepared: () => void;
}> = ({ ctx, screen, arg, crew, onPrepared }) => {
  switch (screen) {
    case 'go': return <GoNowScreen ctx={ctx} />;
    case 'transit': return <TransitScreen ctx={ctx} />;
    case 'place': return <PlaceScreen ctx={ctx} eventId={arg} />;
    case 'checkin': return <CheckinScreen ctx={ctx} />;
    case 'home': return <HomeRouteScreen ctx={ctx} />;
    case 'stamp': return <StampScreen key={arg ?? ''} ctx={ctx} eventId={arg} />;
    case 'memo': return <MemoScreen key={arg ?? ''} ctx={ctx} eventId={arg} />;
    case 'tabicho': return <TabichoScreen ctx={ctx} />;
    case 'timeline': return <TimelineScreen ctx={ctx} />;
    case 'map': return <MapScreen key={arg ?? ''} ctx={ctx} eventId={arg} crew={crew.shares ?? []} />;
    case 'detour': return <DetourScreen ctx={ctx} arg={arg} />;
    case 'rain': return <RainScreen ctx={ctx} />;
    case 'delay': return <DelayScreen ctx={ctx} />;
    case 'ticket': return <TicketScreen ctx={ctx} eventId={arg} />;
    case 'prepare': return <PrepareScreen ctx={ctx} onDone={onPrepared} />;
    case 'photoqr': return <PhotoQrScreen ctx={ctx} />;
    case 'crew': return <CrewScreen ctx={ctx} crew={crew} />;
    case 'help': return <HelpScreen ctx={ctx} />;
    case 'settings': return <SettingsScreen ctx={ctx} />;
    default: return null;
  }
};

export default TodayScreens;
