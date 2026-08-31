import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Mic, Search, Upload, MapPin, Star, Clock, DollarSign, Globe, Zap, Target } from 'lucide-react';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useAuthStore } from '../store/authStore';
import { searchSpots, searchByImage, searchByVoice } from '../services/api';

interface SearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  address?: string;
  rating?: number;
  price_level?: string;
  price_range?: string;
  estimated_duration?: number;
  estimated_cost?: number;
  ai_confidence?: number;
  ai_relevance_score?: number;
  web_source?: string;
  distance_km?: number;
  popularity_score?: number;
}

const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [searchType, setSearchType] = useState<'text' | 'image' | 'voice'>('text');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMetadata, setSearchMetadata] = useState<any>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [userLocation, setUserLocation] = useState({
    latitude: 35.6762,
    longitude: 139.6503
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // 位置情報取得
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          console.log('📍 現在位置を取得しました:', position.coords);
        },
        (error) => {
          console.log('📍 位置情報取得に失敗、デフォルト位置（東京）を使用:', error);
        }
      );
    }
  }, []);

  const handleTextSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error('検索キーワードを入力してください');
      return;
    }
    
    setIsLoading(true);
    setHasSearched(true);
    
    try {
      console.log('🤖 AI検索実行:', searchQuery);
      toast('AI検索エンジンが動作中...');
      
      const response = await searchSpots({
        query: searchQuery,
        location: userLocation,
        max_results: 5
      });
      
      console.log('✅ AI検索レスポンス:', response);
      
      if (response.success && response.data?.spots) {
        setSearchResults(response.data.spots);
        setSearchMetadata(response.data.search_metadata || null);
        toast.success(`AI分析により${response.data.spots.length}件の最適なスポットを発見！`);
      } else {
        setSearchResults([]);
        setSearchMetadata(null);
        toast('検索条件に合うスポットが見つかりませんでした');
      }
    } catch (error) {
      console.error('AI検索エラー:', error);
      setSearchResults([]);
      setSearchMetadata(null);
      toast.error('AI検索中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    
    setUploadedImages(prev => [...prev, ...files].slice(0, 20));
    
    if (files.length > 0) {
      handleImageSearch(files[0]);
    }
  };

  const handleImageSearch = async (imageFile: File) => {
    setIsLoading(true);
    setHasSearched(true);
    
    try {
      console.log('🖼️ AI画像解析開始:', imageFile.name);
      toast('AI画像解析中... 物体検出・スポット特定中');
      
      const response = await searchByImage(imageFile, userLocation);
      
      console.log('✅ AI画像解析レスポンス:', response);
      
      if (response.success && response.data?.spots) {
        setSearchResults(response.data.spots);
        setSearchMetadata(response.data.search_metadata || null);
        
        if (response.data.image_analysis) {
          const analysis = response.data.image_analysis;
          toast.success(`AI画像解析完了: ${analysis.detected_objects?.join(', ')} を検出`);
        } else {
          toast.success(`AI画像解析により${response.data.spots.length}件のスポットを特定！`);
        }
      } else {
        setSearchResults([]);
        setSearchMetadata(null);
        toast('画像から関連スポットを特定できませんでした');
      }
    } catch (error) {
      console.error('AI画像解析エラー:', error);
      setSearchResults([]);
      setSearchMetadata(null);
      toast.error('AI画像解析中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    try {
      console.log('🎤 AI音声認識開始...');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('このブラウザは音声録音をサポートしていません');
      }

      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('音声録音にはHTTPS接続が必要です');
      }

      setIsRecording(true);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          await handleVoiceSearch(audioBlob);
        } catch (error) {
          console.error('音声処理エラー:', error);
          toast.error('音声の処理中にエラーが発生しました');
        } finally {
          stream.getTracks().forEach(track => track.stop());
          setIsRecording(false);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      
      // 自動停止タイマー（30秒後）
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 30000);
      
      console.log('✅ AI音声録音が開始されました');
      toast.success('AI音声認識開始（30秒で自動停止）');
      
    } catch (error) {
      console.error('音声録音エラー:', error);
      setIsRecording(false);
      
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('音声録音に失敗しました');
      }
    }
  };

  const stopVoiceRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        console.log('🛑 AI音声録音を停止しました');
        toast.info('音声録音を停止、AI解析中...');
      }
    } catch (error) {
      console.error('音声録音停止エラー:', error);
      setIsRecording(false);
    }
  };

  const handleVoiceSearch = async (audioBlob: Blob) => {
    if (!audioBlob || audioBlob.size === 0) {
      toast.error('音声データが空です');
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    
    try {
      console.log('🤖 AI音声解析実行中...', { 
        blobSize: audioBlob.size, 
        blobType: audioBlob.type 
      });
      
      toast('AI音声認識・自然言語処理中...');
      
      const response = await searchByVoice(audioBlob, {
        location: userLocation,
        language: 'ja',
        max_results: 5
      });
      
      console.log('✅ AI音声解析レスポンス:', response);
      
      if (response.success && response.data) {
        if (response.data.transcribed_text) {
          setSearchQuery(response.data.transcribed_text);
        }
        if (response.data.spots) {
          setSearchResults(response.data.spots);
          setSearchMetadata(response.data.search_metadata || null);
          toast.success(`音声認識成功: "${response.data.transcribed_text}" → ${response.data.spots.length}件のスポットを発見！`);
        } else {
          setSearchResults([]);
          setSearchMetadata(null);
          toast('音声から関連スポットを見つけられませんでした');
        }
      } else {
        setSearchResults([]);
        setSearchMetadata(null);
        toast.error(response.message || 'AI音声解析に失敗しました');
      }
      
    } catch (error) {
      console.error('AI音声解析エラー:', error);
      setSearchResults([]);
      setSearchMetadata(null);
      toast.error('AI音声解析中にエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  const addSpotToPlan = (spot: SearchResult) => {
    toast.success(`${spot.name}をプランに追加しました`);
    navigate('/planner', { state: { newSpot: spot } });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'restaurant': return '🍜';
      case 'tourist_attraction': return '🏛️';
      case 'shopping_mall': return '🛍️';
      case 'lodging': return '🏨';
      case 'park': return '🌳';
      case 'cafe': return '☕';
      default: return '📍';
    }
  };

  const getPriceLevelText = (level: string) => {
    switch (level) {
      case 'free': return '無料';
      case 'low': return '💰';
      case 'medium': return '💰💰';
      case 'high': return '💰💰💰';
      default: return '💰';
    }
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            🤖 AIスポット検索
          </h1>
          <p className="text-gray-600">
            高度なAI技術でインターネット上の情報を解析し、あなたに最適な旅行スポットをランキング表示
          </p>
          <div className="mt-2 flex justify-center items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1"><Globe size={14} /> Web情報統合</span>
            <span className="flex items-center gap-1"><Zap size={14} /> AI分析</span>
            <span className="flex items-center gap-1"><Target size={14} /> 位置最適化</span>
          </div>
        </div>

        {/* 検索タイプ選択 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <div className="flex flex-wrap gap-4 mb-6">
            <button
              onClick={() => setSearchType('text')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                searchType === 'text'
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
              }`}
            >
              <Search size={18} />
              AIテキスト検索
            </button>
            <button
              onClick={() => setSearchType('image')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                searchType === 'image'
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
              }`}
            >
              <Camera size={18} />
              AI画像解析
            </button>
            <button
              onClick={() => setSearchType('voice')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                searchType === 'voice'
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
              }`}
            >
              <Mic size={18} />
              AI音声認識
            </button>
          </div>

          {/* テキスト検索 */}
          {searchType === 'text' && (
            <div className="flex gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="例: 渋谷の美味しいラーメン店、東京の観光地、カフェでゆっくりしたい..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && handleTextSearch()}
                />
              </div>
              <button
                onClick={handleTextSearch}
                disabled={!searchQuery.trim() || isLoading}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? <LoadingSpinner size="small" /> : <Search size={18} />}
                AI検索
              </button>
            </div>
          )}

          {/* 画像検索 */}
          {searchType === 'image' && (
            <div>
              <div 
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={48} className="mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 mb-2">
                  写真をアップロードしてAI画像解析
                </p>
                <p className="text-sm text-gray-500">
                  建物、料理、風景等を自動認識してスポットを特定
                </p>
                <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                  画像を選択
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
              
              {/* アップロード済み画像プレビュー */}
              {uploadedImages.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-gray-600 mb-2">解析済み画像:</p>
                  <div className="grid grid-cols-6 gap-2">
                    {uploadedImages.map((file, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={`Analyzed ${index + 1}`}
                          className="w-full h-16 object-cover rounded border"
                        />
                        <button
                          onClick={() => removeUploadedImage(index)}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 音声検索 */}
          {searchType === 'voice' && (
            <div className="text-center">
              <div className="inline-flex flex-col items-center">
                <button
                  onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                  disabled={isLoading}
                  className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl transition-all ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                      : 'bg-blue-500 hover:bg-blue-600'
                  } disabled:opacity-50`}
                >
                  <Mic size={32} />
                </button>
                <p className="mt-4 text-gray-600">
                  {isRecording ? 'AI音声認識中... クリックで停止' : 'AI音声認識を開始'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  自然な話し言葉で検索内容を話してください
                </p>
                {searchQuery && (
                  <div className="mt-3 bg-gray-100 px-4 py-2 rounded-lg">
                    <p className="text-sm text-gray-600">認識結果:</p>
                    <p className="font-medium">「{searchQuery}」</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 検索メタデータ表示 */}
        {searchMetadata && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={16} className="text-blue-600" />
              <span className="font-medium text-blue-800">AI検索情報</span>
            </div>
            <div className="text-sm text-blue-700">
              <p>検索タイプ: {searchMetadata.search_type}</p>
              {searchMetadata.ranking_factors && (
                <p>ランキング要素: {searchMetadata.ranking_factors.join(', ')}</p>
              )}
              {searchMetadata.confidence && (
                <p>AI信頼度: {Math.round(searchMetadata.confidence * 100)}%</p>
              )}
            </div>
          </div>
        )}

        {/* 検索結果 */}
        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner />
            <span className="ml-3 text-gray-600">AI分析中...</span>
          </div>
        ) : hasSearched && searchResults.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Search size={48} className="mx-auto mb-4 opacity-50" />
            <p>AI検索結果が見つかりませんでした</p>
            <p className="text-sm mt-2">別の検索条件で試してみてください</p>
          </div>
        ) : searchResults.length > 0 ? (
          <div className="space-y-6">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">AI推奨スポット（上位{searchResults.length}件）</h2>
              <p className="text-sm text-gray-600">AIアルゴリズムによって最適化された順序で表示</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {searchResults.map((spot, index) => (
                <div key={spot.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 relative">
                  {/* AIランキングバッジ */}
                  <div className="absolute -top-2 -left-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                    {index + 1}
                  </div>
                  
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg text-gray-900 mb-1">
                        {getCategoryIcon(spot.category)} {spot.name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        {spot.rating && (
                          <>
                            <Star size={14} className="text-yellow-400 fill-current" />
                            <span>{spot.rating}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>{getPriceLevelText(spot.price_level || spot.price_range || 'medium')}</span>
                        {spot.distance_km && (
                          <>
                            <span>•</span>
                            <span>{spot.distance_km.toFixed(1)}km</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* AI信頼度表示 */}
                    <div className="flex flex-col items-end gap-1">
                      {spot.ai_confidence && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          AI信頼度: {Math.round(spot.ai_confidence * 100)}%
                        </span>
                      )}
                      {spot.ai_relevance_score && (
                        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                          関連度: {spot.ai_relevance_score}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                    {spot.description}
                  </p>
                  
                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                    <div className="flex items-center gap-1">
                      <MapPin size={12} />
                      <span>{spot.location?.address || spot.address || '住所情報なし'}</span>
                    </div>
                  </div>

                  {/* Web情報源表示 */}
                  {spot.web_source && (
                    <div className="text-xs text-gray-400 mb-3 flex items-center gap-1">
                      <Globe size={12} />
                      <span>情報源: {spot.web_source}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div className="flex gap-4 text-xs">
                      {spot.estimated_duration && (
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          <span>{spot.estimated_duration}分</span>
                        </div>
                      )}
                      {spot.estimated_cost !== undefined && (
                        <div className="flex items-center gap-1">
                          <DollarSign size={12} />
                          <span>¥{spot.estimated_cost}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => addSpotToPlan(spot)}
                      className="px-3 py-1 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs rounded hover:from-blue-600 hover:to-purple-700 transition-colors"
                    >
                      プランに追加
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : !hasSearched ? (
          <div className="text-center py-12 text-gray-500">
            <div className="mb-4">
              <div className="flex justify-center items-center gap-4 mb-4">
                <Search size={32} className="text-blue-500" />
                <Zap size={32} className="text-purple-500" />
                <Target size={32} className="text-green-500" />
              </div>
            </div>
            <p className="text-lg font-medium">AI検索エンジンが待機中</p>
            <p className="text-sm mt-2">上記の検索機能を使ってスポットを探してみましょう</p>
            <div className="mt-4 text-xs text-gray-400">
              <p>• テキスト検索: 自然言語での検索</p>
              <p>• 画像解析: 写真からスポット特定</p>
              <p>• 音声認識: 話し言葉での検索</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SearchPage;