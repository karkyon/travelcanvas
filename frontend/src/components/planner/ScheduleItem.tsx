import React, { useState, useRef } from 'react';
import { 
  Clock, MapPin, DollarSign, Edit3, Trash2, Share2, 
  Star, Phone, ExternalLink, Navigation, AlertTriangle 
} from 'lucide-react';

interface ScheduleItemProps {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  duration: number;
  locationName: string;
  address: string;
  cost?: number;
  currency?: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  travelMethod?: string;
  travelTime?: number;
  travelCost?: number;
  notes?: string;
  rating?: number;
  isNext?: boolean;
  isCompleted?: boolean;
  isDelayed?: boolean;
  bookingInfo?: {
    url?: string;
    phone?: string;
  };
  contactInfo?: {
    website?: string;
    phone?: string;
  };
  onUpdate?: (id: string, data: any) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onShare?: (id: string) => void;
  isDragging?: boolean;
  dragRef?: React.RefObject<HTMLDivElement>;
  style?: React.CSSProperties;
}

const ScheduleItem: React.FC<ScheduleItemProps> = ({
  id,
  title,
  description,
  startTime,
  endTime,
  duration,
  locationName,
  address,
  cost,
  currency = 'JPY',
  category,
  priority,
  travelMethod,
  travelTime,
  travelCost,
  notes,
  rating,
  isNext = false,
  isCompleted = false,
  isDelayed = false,
  bookingInfo,
  contactInfo,
  onUpdate,
  onDelete,
  onEdit,
  onShare,
  isDragging = false,
  dragRef,
  style
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title,
    startTime,
    endTime,
    notes: notes || ''
  });

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'sightseeing': return '🏛️';
      case 'food': return '🍜';
      case 'shopping': return '🛍️';
      case 'accommodation': return '🏨';
      case 'transport': return '🚃';
      case 'activity': return '🎯';
      case 'entertainment': return '🎭';
      default: return '📍';
    }
  };

  const getPriorityColor = (prio: string) => {
    switch (prio) {
      case 'high': return 'border-red-500 bg-red-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-green-500 bg-green-50';
      default: return 'border-gray-300 bg-white';
    }
  };

  const getTravelMethodIcon = (method?: string) => {
    switch (method) {
      case 'train': return '🚃';
      case 'bus': return '🚌';
      case 'car': return '🚗';
      case 'taxi': return '🚕';
      case 'walking': return '🚶';
      case 'bicycle': return '🚲';
      case 'plane': return '✈️';
      default: return '🚃';
    }
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '';
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatTime = (time: string) => {
    return time.substring(0, 5); // HH:MM format
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
    }
    return `${minutes}分`;
  };

  const handleSaveEdit = () => {
    if (onUpdate) {
      onUpdate(id, editData);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditData({ title, startTime, endTime, notes: notes || '' });
    setIsEditing(false);
  };

  const baseClasses = `
    relative bg-white border rounded-xl p-4 mb-3 cursor-grab transition-all duration-200
    ${isDragging ? 'opacity-80 scale-105 rotate-1 shadow-xl z-50' : 'hover:shadow-md'}
    ${isNext ? 'border-orange-400 bg-orange-50 shadow-lg' : ''}
    ${isCompleted ? 'opacity-60 bg-gray-50' : ''}
    ${isDelayed ? 'border-red-400 bg-red-50' : getPriorityColor(priority)}
    ${isEditing ? 'border-blue-400 bg-blue-50' : ''}
  `;

  return (
    <div
      ref={dragRef}
      className={baseClasses}
      style={style}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* Next Badge */}
      {isNext && (
        <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full">
          NEXT
        </div>
      )}

      {/* Delay Warning */}
      {isDelayed && (
        <div className="absolute -top-2 -left-2 bg-red-500 text-white p-1 rounded-full">
          <AlertTriangle size={12} />
        </div>
      )}

      {/* Main Content */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Time and Title */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1 text-sm font-semibold text-gray-700">
              <Clock size={14} />
              <span>{formatTime(startTime)}-{formatTime(endTime)}</span>
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {getCategoryIcon(category)} {isEditing ? (
                <input
                  type="text"
                  value={editData.title}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  className="border-b border-blue-400 bg-transparent focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : title}
            </div>
          </div>

          {/* Location and Basic Info */}
          <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
            <div className="flex items-center gap-1">
              <MapPin size={12} />
              <span>{locationName}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock size={12} />
              <span>滞在: {formatDuration(duration)}</span>
            </div>
            {cost && (
              <div className="flex items-center gap-1">
                <DollarSign size={12} />
                <span>{formatCurrency(cost)}</span>
              </div>
            )}
            {rating && (
              <div className="flex items-center gap-1">
                <Star size={12} className="text-yellow-400 fill-current" />
                <span>{rating}</span>
              </div>
            )}
          </div>

          {/* Travel Info */}
          {travelMethod && travelTime && (
            <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded mb-2">
              <span>{getTravelMethodIcon(travelMethod)}</span>
              <span>移動: {formatDuration(travelTime)}</span>
              {travelCost && <span>• {formatCurrency(travelCost)}</span>}
            </div>
          )}

          {/* Description */}
          {description && !isExpanded && (
            <p className="text-sm text-gray-600 line-clamp-1">{description}</p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 ml-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
            title="編集"
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShare?.(id);
            }}
            className="p-1 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded transition-colors"
            title="共有"
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(id);
            }}
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="削除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
          {/* Description */}
          {description && (
            <div className="mb-3">
              <p className="text-sm text-gray-700">{description}</p>
            </div>
          )}

          {/* Address */}
          <div className="mb-3">
            <div className="flex items-center gap-2 text-sm">
              <MapPin size={14} className="text-gray-400" />
              <span className="text-gray-600">{address}</span>
              <button className="text-blue-500 hover:text-blue-700">
                <Navigation size={14} />
              </button>
            </div>
          </div>

          {/* Notes */}
          {(notes || isEditing) && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">メモ</label>
              {isEditing ? (
                <textarea
                  value={editData.notes}
                  onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                  className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                  placeholder="メモを追加..."
                />
              ) : (
                <p className="text-sm text-gray-600">{notes}</p>
              )}
            </div>
          )}

          {/* Contact & Booking Info */}
          {(contactInfo || bookingInfo) && (
            <div className="flex flex-wrap gap-4 mb-3">
              {contactInfo?.website && (
                <a
                  href={contactInfo.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
                >
                  <ExternalLink size={14} />
                  公式サイト
                </a>
              )}
              {contactInfo?.phone && (
                <a
                  href={`tel:${contactInfo.phone}`}
                  className="flex items-center gap-1 text-sm text-green-500 hover:text-green-700"
                >
                  <Phone size={14} />
                  {contactInfo.phone}
                </a>
              )}
              {bookingInfo?.url && (
                <a
                  href={bookingInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-purple-500 hover:text-purple-700"
                >
                  <ExternalLink size={14} />
                  予約
                </a>
              )}
            </div>
          )}

          {/* Edit Actions */}
          {isEditing && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              >
                保存
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600"
              >
                キャンセル
              </button>
            </div>
          )}
        </div>
      )}

      {/* Completed Overlay */}
      {isCompleted && (
        <div className="absolute top-2 right-2">
          <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center">
            <span className="text-xs">✓</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleItem;