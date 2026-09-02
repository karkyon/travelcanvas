import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Zap, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { env } from '../../config/env';

interface MapLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  order?: number;
  isVisited?: boolean;
  isCurrent?: boolean;
  estimatedArrival?: string;
}

interface MapRoute {
  id: string;
  fromLocation: MapLocation;
  toLocation: MapLocation;
  travelMethod: string;
  duration: number;
  distance: number;
  isOptimized?: boolean;
}

interface MapViewProps {
  locations: MapLocation[];
  routes?: MapRoute[];
  centerLocation?: { latitude: number; longitude: number };
  zoom?: number;
  height?: string;
  showRoutes?: boolean;
  showMarkers?: boolean;
  onLocationClick?: (location: MapLocation) => void;
  onRouteClick?: (route: MapRoute) => void;
  className?: string;
}

// Google Maps が利用できない場合のダミーマップコンポーネント
const DummyMap: React.FC<{
  locations: MapLocation[];
  height: string;
  onLocationClick?: (location: MapLocation) => void;
}> = ({ locations, height, onLocationClick }) => {
  return (
    <div 
      className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center relative"
      style={{ height }}
    >
      <MapPin size={48} className="text-gray-400 mb-4" />
      <p className="text-gray-600 mb-4 text-center">
        🗺️ 地図表示エリア<br />
        {locations.length}個のロケーション
      </p>
      
      {/* ロケーション一覧 */}
      <div className="absolute bottom-4 left-4 right-4 max-h-32 overflow-y-auto">
        <div className="bg-white rounded-lg shadow-sm p-3">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">スポット一覧</h4>
          <div className="space-y-1">
            {locations.map((location, index) => (
              <button
                key={location.id}
                onClick={() => onLocationClick?.(location)}
                className="w-full text-left p-2 text-xs bg-gray-50 hover:bg-blue-50 rounded flex items-center gap-2"
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] ${
                  location.isCurrent ? 'bg-orange-500' : location.isVisited ? 'bg-green-500' : 'bg-blue-500'
                }`}>
                  {index + 1}
                </span>
                <span className="truncate">{location.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const MapView: React.FC<MapViewProps> = ({
  locations,
  routes = [],
  centerLocation,
  zoom = 13,
  height = '400px',
  showRoutes = true,
  showMarkers = true,
  onLocationClick,
  onRouteClick: _onRouteClick,
  className = ''
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const [showOptimizedRoute, setShowOptimizedRoute] = useState(true);
  const [currentView, setCurrentView] = useState<'hybrid' | 'roadmap' | 'satellite'>('roadmap');

  // Google Maps API の初期化
  useEffect(() => {
    const initGoogleMaps = () => {
      // Google Maps API が利用可能かチェック
      if (typeof window !== 'undefined' && (window as any).google?.maps) {
        setIsGoogleMapsLoaded(true);
        return;
      }

      // Google Maps API スクリプトを動的に読み込み
      if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${env.GOOGLE_MAPS_API_KEY}&libraries=geometry,places`;
        script.async = true;
        script.defer = true;
        script.onload = () => setIsGoogleMapsLoaded(true);
        document.head.appendChild(script);
      }
    };

    initGoogleMaps();
  }, []);

  // マップの初期化
  useEffect(() => {
    if (isGoogleMapsLoaded && mapRef.current && !mapInstance) {
      const google = (window as any).google;
      
      const center = centerLocation || (locations.length > 0 ? {
        lat: locations[0]!.latitude,
        lng: locations[0]!.longitude
      } : { lat: 35.6762, lng: 139.6503 }); // デフォルト: 東京

      const map = new google.maps.Map(mapRef.current, {
        zoom,
        center,
        mapTypeId: currentView,
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        zoomControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'on' }]
          }
        ]
      });

      setMapInstance(map);
    }
  }, [isGoogleMapsLoaded, centerLocation, zoom, currentView]);

  // マーカーとルートの表示
  useEffect(() => {
    if (!mapInstance || !isGoogleMapsLoaded) return;

    const google = (window as any).google;

    // 既存のマーカーとルートをクリア
    // （実際の実装では、マーカーとルートの参照を保持して削除）

    if (showMarkers && locations.length > 0) {
      // マーカーを追加
      locations.forEach((location, index) => {
        const marker = new google.maps.Marker({
          position: { lat: location.latitude, lng: location.longitude },
          map: mapInstance,
          title: location.name,
          label: {
            text: (index + 1).toString(),
            color: 'white',
            fontWeight: 'bold',
            fontSize: '12px'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 15,
            fillColor: location.isCurrent ? '#f97316' : location.isVisited ? '#10b981' : '#3b82f6',
            fillOpacity: 1,
            strokeColor: 'white',
            strokeWeight: 2
          }
        });

        // インフォウィンドウ
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div class="p-2">
              <h3 class="font-semibold text-gray-900 mb-1">${location.name}</h3>
              <p class="text-sm text-gray-600">カテゴリ: ${location.category}</p>
              ${location.estimatedArrival ? `<p class="text-sm text-blue-600">到着予定: ${location.estimatedArrival}</p>` : ''}
            </div>
          `
        });

        marker.addListener('click', () => {
          infoWindow.open(mapInstance, marker);
          onLocationClick?.(location);
        });
      });

      // 地図の範囲を調整
      if (locations.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        locations.forEach(location => {
          bounds.extend(new google.maps.LatLng(location.latitude, location.longitude));
        });
        mapInstance.fitBounds(bounds);
      }
    }

    // ルートを表示
    if (showRoutes && routes.length > 0 && showOptimizedRoute) {
      const directionsService = new google.maps.DirectionsService();
      const directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true, // カスタムマーカーを使用するため
        polylineOptions: {
          strokeColor: '#3b82f6',
          strokeWeight: 4,
          strokeOpacity: 0.8
        }
      });

      directionsRenderer.setMap(mapInstance);

      // 複数地点のルートを計算
      if (locations.length > 1) {
        const waypoints = locations.slice(1, -1).map(location => ({
          location: new google.maps.LatLng(location.latitude, location.longitude),
          stopover: true
        }));

        const request = {
          origin: new google.maps.LatLng(locations[0]!.latitude, locations[0]!.longitude),
          destination: new google.maps.LatLng(locations[locations.length - 1]!.latitude, locations[locations.length - 1]!.longitude),
          waypoints,
          travelMode: google.maps.TravelMode.TRANSIT,
          optimizeWaypoints: true
        };

        directionsService.route(request, (result: any, status: any) => {
          if (status === 'OK') {
            directionsRenderer.setDirections(result);
          }
        });
      }
    }
  }, [mapInstance, locations, routes, showMarkers, showRoutes, showOptimizedRoute]);

  const handleViewChange = (view: 'hybrid' | 'roadmap' | 'satellite') => {
    setCurrentView(view);
    if (mapInstance) {
      mapInstance.setMapTypeId(view);
    }
  };

  const handleResetView = () => {
    if (mapInstance && locations.length > 0) {
      const google = (window as any).google;
      if (locations.length === 1) {
        mapInstance.setCenter({
          lat: locations[0]!.latitude,
          lng: locations[0]!.longitude
        });
        mapInstance.setZoom(zoom);
      } else {
        const bounds = new google.maps.LatLngBounds();
        locations.forEach(location => {
          bounds.extend(new google.maps.LatLng(location.latitude, location.longitude));
        });
        mapInstance.fitBounds(bounds);
      }
    }
  };

  // Google Maps が利用できない場合はダミーマップを表示
  if (!isGoogleMapsLoaded || !env.GOOGLE_MAPS_API_KEY) {
    return (
      <div className={className}>
        <DummyMap 
          locations={locations} 
          height={height} 
          onLocationClick={onLocationClick}
        />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* マップコントロール */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <div className="bg-white rounded-lg shadow-md p-2">
          <div className="flex gap-1">
            <button
              onClick={() => handleViewChange('roadmap')}
              className={`px-2 py-1 text-xs rounded ${
                currentView === 'roadmap' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              地図
            </button>
            <button
              onClick={() => handleViewChange('satellite')}
              className={`px-2 py-1 text-xs rounded ${
                currentView === 'satellite' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              衛星
            </button>
            <button
              onClick={() => handleViewChange('hybrid')}
              className={`px-2 py-1 text-xs rounded ${
                currentView === 'hybrid' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              混合
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-2">
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setShowOptimizedRoute(!showOptimizedRoute)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
                showOptimizedRoute ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {showOptimizedRoute ? <Eye size={12} /> : <EyeOff size={12} />}
              ルート
            </button>
            <button
              onClick={handleResetView}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              <RotateCcw size={12} />
              リセット
            </button>
          </div>
        </div>
      </div>

      {/* 最適化インジケーター */}
      {showOptimizedRoute && routes.some(r => r.isOptimized) && (
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-green-100 border border-green-300 text-green-800 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
            <Zap size={14} />
            AI最適化ルート
          </div>
        </div>
      )}

      {/* 統計情報 */}
      {routes.length > 0 && (
        <div className="absolute bottom-4 left-4 z-10">
          <div className="bg-white rounded-lg shadow-md p-3 text-sm">
            <h4 className="font-semibold text-gray-900 mb-2">ルート情報</h4>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">総距離:</span>
                <span className="font-medium">
                  {routes.reduce((sum, route) => sum + route.distance, 0).toFixed(1)}km
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">総移動時間:</span>
                <span className="font-medium">
                  {Math.round(routes.reduce((sum, route) => sum + route.duration, 0))}分
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">スポット数:</span>
                <span className="font-medium">{locations.length}箇所</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Maps コンテナ */}
      <div
        ref={mapRef}
        style={{ height }}
        className="w-full rounded-lg overflow-hidden"
      />
    </div>
  );
};

export default MapView;