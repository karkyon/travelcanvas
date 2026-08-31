import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, MapPin, AlertTriangle } from 'lucide-react';
import { usePlanStore } from '@/store/planStore';
import { timeUntil, formatTime, cn } from '@/utils';

const TimeProgressBanner: React.FC = () => {
  const { currentPlan, currentDayIndex } = usePlanStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  // 現在時刻の更新
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // 1分ごとに更新

    return () => clearInterval(timer);
  }, []);

  // 現在の日のスケジュール取得
  const currentDay = currentPlan?.days[currentDayIndex];
  const events = currentDay?.events || [];

  // 次の予定を計算
  const findNextEvent = () => {
    const now = currentTime;
    const currentTimeString = now.toTimeString().slice(0, 5); // HH:MM format

    for (const event of events) {
      const eventStartTime = event.start_time;
      const eventEndTime = event.end_time;

      // 現在時刻と比較
      if (currentTimeString < eventStartTime) {
        // まだ始まっていない予定
        return {
          ...event,
          timeUntil: timeUntil(eventStartTime),
          status: 'upcoming' as const
        };
      } else if (currentTimeString >= eventStartTime && currentTimeString <= eventEndTime) {
        // 進行中の予定
        return {
          ...event,
          timeUntil: { text: '進行中', isOverdue: false },
          status: 'current' as const
        };
      }
    }

    // 未来の予定がない場合
    for (const event of events) {
      if (currentTimeString > event.end_time) {
        continue;
      }
      return {
        ...event,
        timeUntil: { text: '予定が遅れています', isOverdue: true },
        status: 'overdue' as const
      };
    }

    return null;
  };

  const nextEvent = findNextEvent();

  // 進行状況の計算
  const calculateProgress = () => {
    if (!events.length) return { completed: 0, total: 0, percentage: 0 };

    const now = currentTime;
    const currentTimeString = now.toTimeString().slice(0, 5);
    
    let completed = 0;
    for (const event of events) {
      if (currentTimeString > event.end_time) {
        completed++;
      }
    }

    const total = events.length;
    const percentage = total > 0 ? (completed / total) * 100 : 0;

    return { completed, total, percentage };
  };

  const progress = calculateProgress();

  // 今日が旅行日かチェック
  const isToday = () => {
    if (!currentDay) return false;
    const today = new Date().toISOString().split('T')[0];
    return currentDay.date === today;
  };

  // 旅行日でない場合は表示しない
  if (!isToday() || !currentDay) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={cn(
        'px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 dark:border-gray-700',
        nextEvent?.status === 'overdue' 
          ? 'bg-gradient-to-r from-red-500 to-orange-500' 
          : nextEvent?.status === 'current'
          ? 'bg-gradient-to-r from-green-500 to-emerald-500'
          : 'bg-gradient-to-r from-primary-500 to-accent-500'
      )}
    >
      <div className="flex items-center justify-between">
        {/* 現在時刻 */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-white">
            <Clock className="w-5 h-5" />
            <div>
              <div className="text-lg font-bold">
                現在時刻: {currentTime.toLocaleTimeString('ja-JP', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </div>
              <div className="text-sm opacity-90">
                {currentTime.toLocaleDateString('ja-JP', { 
                  month: 'long', 
                  day: 'numeric',
                  weekday: 'short' 
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 次の予定 */}
        <div className="flex items-center space-x-4">
          {nextEvent ? (
            <div className="text-right text-white">
              <div className="flex items-center space-x-2 justify-end mb-1">
                {nextEvent.status === 'overdue' && (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <MapPin className="w-4 h-4" />
                <span className="font-semibold">
                  {nextEvent.status === 'current' ? '現在の予定' : '次の予定'}:
                </span>
              </div>
              <div className="text-lg font-bold">{nextEvent.title}</div>
              <div className="text-sm opacity-90">
                <span className={cn(
                  nextEvent.timeUntil.isOverdue && 'animate-pulse'
                )}>
                  {nextEvent.timeUntil.text}
                </span>
                {nextEvent.status !== 'current' && (
                  <>
                    {' '}({formatTime(nextEvent.start_time)}-)
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-right text-white">
              <div className="font-semibold">本日の予定</div>
              <div className="text-sm opacity-90">
                {events.length > 0 ? 'すべて完了しました！' : 'まだ予定がありません'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 進行状況バー */}
      {events.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-white text-sm mb-2">
            <span>進行状況</span>
            <span>{progress.completed}/{progress.total} 完了</span>
          </div>
          <div className="w-full bg-white/30 rounded-full h-2 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.percentage}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-white rounded-full shadow-sm"
            />
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TimeProgressBanner;