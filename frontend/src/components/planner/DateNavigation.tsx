import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, MapPin, Clock, DollarSign, CheckCircle } from 'lucide-react';

interface DayTab {
  index: number;
  date: string;
  dayOfWeek: string;
  isActive: boolean;
  isCompleted: boolean;
  eventCount: number;
  status: 'upcoming' | 'current' | 'completed';
  highlights: string[];
  totalCost: number;
  totalDuration: number;
}

interface DateNavigationProps {
  days: DayTab[];
  currentDay: number;
  onDayChange: (dayIndex: number) => void;
  travelDates: {
    startDate: string;
    endDate: string;
  };
  className?: string;
}

const DateNavigation: React.FC<DateNavigationProps> = ({
  days,
  currentDay,
  onDayChange,
  travelDates,
  className = ''
}) => {
  const [showOverview, setShowOverview] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    checkScrollPosition();
  }, [days]);

  useEffect(() => {
    // アクティブなタブが見えるようにスクロール
    scrollToActiveTab();
  }, [currentDay]);

  const checkScrollPosition = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  const scrollToActiveTab = () => {
    if (scrollRef.current) {
      const activeTab = scrollRef.current.querySelector(`[data-day="${currentDay}"]`) as HTMLElement;
      if (activeTab) {
        const containerLeft = scrollRef.current.scrollLeft;
        const containerRight = containerLeft + scrollRef.current.clientWidth;
        const tabLeft = activeTab.offsetLeft;
        const tabRight = tabLeft + activeTab.offsetWidth;

        if (tabLeft < containerLeft) {
          scrollRef.current.scrollTo({
            left: tabLeft - 20,
            behavior: 'smooth'
          });
        } else if (tabRight > containerRight) {
          scrollRef.current.scrollTo({
            left: tabRight - scrollRef.current.clientWidth + 20,
            behavior: 'smooth'
          });
        }
      }
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      const newScrollLeft = scrollRef.current.scrollLeft + (direction === 'right' ? scrollAmount : -scrollAmount);
      scrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      });
    }
  };

  const handleDayClick = (dayIndex: number) => {
    onDayChange(dayIndex);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}時間` : `${minutes}分`;
  };

  const getStatusIcon = (status: string, isCompleted: boolean) => {
    if (isCompleted) {
      return <CheckCircle size={12} className="text-green-500" />;
    }
    
    switch (status) {
      case 'current':
        return <div className="w-3 h-3 bg-orange-400 rounded-full animate-pulse" />;
      case 'upcoming':
        return <div className="w-3 h-3 bg-blue-400 rounded-full" />;
      case 'completed':
        return <CheckCircle size={12} className="text-green-500" />;
      default:
        return <div className="w-3 h-3 bg-gray-300 rounded-full" />;
    }
  };

  const getDayLabel = (index: number) => {
    if (index === 0) return 'DAY1';
    return `DAY${index + 1}`;
  };

  return (
    <div className={`bg-white border-b border-gray-200 ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-gray-600" />
          <span className="text-sm font-medium text-gray-700">
            旅行期間: {travelDates.startDate} 〜 {travelDates.endDate}
          </span>
        </div>
        <button
          onClick={() => setShowOverview(!showOverview)}
          className="text-sm text-blue-500 hover:text-blue-700 font-medium"
        >
          {showOverview ? '概要を閉じる' : '概要を表示'}
        </button>
      </div>

      {/* 日付タブナビゲーション */}
      <div className="relative">
        {/* 左スクロールボタン */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 z-10 h-full px-2 bg-gradient-to-r from-white via-white to-transparent hover:from-gray-50 transition-colors"
          >
            <ChevronLeft size={16} className="text-gray-600" />
          </button>
        )}

        {/* 右スクロールボタン */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 z-10 h-full px-2 bg-gradient-to-l from-white via-white to-transparent hover:from-gray-50 transition-colors"
          >
            <ChevronRight size={16} className="text-gray-600" />
          </button>
        )}

        {/* タブコンテナ */}
        <div
          ref={scrollRef}
          className="flex overflow-x-auto scrollbar-hide py-3 px-4 gap-2"
          onScroll={checkScrollPosition}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {days.map((day, index) => (
            <button
              key={day.index}
              data-day={day.index}
              onClick={() => handleDayClick(day.index)}
              className={`
                relative flex-shrink-0 min-w-[90px] p-3 rounded-lg border-2 transition-all duration-200
                ${day.isActive 
                  ? 'border-blue-500 bg-blue-50 shadow-md transform scale-105' 
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                }
              `}
            >
              {/* ステータスインジケーター */}
              <div className="absolute -top-1 -right-1">
                {getStatusIcon(day.status, day.isCompleted)}
              </div>

              <div className="text-center">
                {/* Day Label */}
                <div className={`text-xs font-bold mb-1 ${
                  day.isActive ? 'text-blue-700' : 'text-gray-600'
                }`}>
                  {getDayLabel(index)}
                </div>

                {/* Date */}
                <div className={`text-sm font-semibold mb-1 ${
                  day.isActive ? 'text-blue-900' : 'text-gray-900'
                }`}>
                  {day.date}
                </div>

                {/* Day of Week */}
                <div className={`text-xs mb-2 ${
                  day.isActive ? 'text-blue-600' : 'text-gray-500'
                }`}>
                  ({day.dayOfWeek})
                </div>

                {/* Event Count */}
                <div className={`text-xs px-2 py-1 rounded-full ${
                  day.isActive 
                    ? 'bg-blue-200 text-blue-800' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {day.eventCount}件
                </div>
              </div>

              {/* 完了バッジ */}
              {day.isCompleted && (
                <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                  <div className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center">
                    <span className="text-[8px]">✓</span>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 概要表示 */}
      {showOverview && (
        <div className="border-t border-gray-200 bg-gray-50 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {days.map((day, index) => (
              <div
                key={day.index}
                className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                  day.isActive 
                    ? 'border-blue-300 bg-blue-50' 
                    : 'border-gray-200 bg-white hover:border-blue-200'
                }`}
                onClick={() => handleDayClick(day.index)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900">
                    {getDayLabel(index)} ({day.date})
                  </span>
                  {getStatusIcon(day.status, day.isCompleted)}
                </div>

                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <MapPin size={12} />
                    <span>{day.eventCount}個のスポット</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span>{formatDuration(day.totalDuration)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign size={12} />
                    <span>{formatCurrency(day.totalCost)}</span>
                  </div>
                </div>

                {/* ハイライト */}
                {day.highlights.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <div className="text-xs text-gray-500 mb-1">主要スポット:</div>
                    <div className="text-xs text-gray-700">
                      {day.highlights.slice(0, 2).map((highlight, idx) => (
                        <div key={idx} className="truncate">• {highlight}</div>
                      ))}
                      {day.highlights.length > 2 && (
                        <div className="text-gray-400">他{day.highlights.length - 2}件...</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 全体統計 */}
          <div className="mt-4 pt-4 border-t border-gray-300">
            <h4 className="font-semibold text-gray-900 mb-2">旅行全体の統計</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {days.reduce((sum, day) => sum + day.eventCount, 0)}
                </div>
                <div className="text-gray-600">総スポット数</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">
                  {formatDuration(days.reduce((sum, day) => sum + day.totalDuration, 0))}
                </div>
                <div className="text-gray-600">総所要時間</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-purple-600">
                  {formatCurrency(days.reduce((sum, day) => sum + day.totalCost, 0))}
                </div>
                <div className="text-gray-600">総予算</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-600">
                  {days.filter(day => day.isCompleted).length}/{days.length}
                </div>
                <div className="text-gray-600">完了日数</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateNavigation;