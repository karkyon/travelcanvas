import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSearch } from '../../hooks/useSearch';
import { useToast } from '../common/Toast';
import Button from '../common/Button';
import Card from '../common/Card';
import { LoadingSpinner } from '../common/LoadingSpinner';
import type { VoiceSearchResult } from '../../types';

interface VoiceSearchProps {
  onSpotSelect?: (spot: any) => void;
  onResultsChange?: (results: VoiceSearchResult) => void;
  className?: string;
}

const VoiceSearch: React.FC<VoiceSearchProps> = ({
  onSpotSelect,
  onResultsChange,
  className = ''
}) => {
  const { voiceSearch, startVoiceRecording, loading } = useSearch();
  const { addToast } = useToast();
  
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [searchResults, setSearchResults] = useState<VoiceSearchResult | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // 音声レベル測定の開始
  const startAudioLevelMonitoring = useCallback((stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 256;
    source.connect(analyser);
    
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateAudioLevel = () => {
      if (analyserRef.current && isRecording) {
        analyser.getByteFrequencyData(dataArray);
        
        // 音声レベルを計算（0-100の範囲）
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const level = Math.min(100, (average / 128) * 100);
        
        setAudioLevel(level);
        animationRef.current = requestAnimationFrame(updateAudioLevel);
      }
    };
    
    updateAudioLevel();
  }, [isRecording]);

  // 録音開始
  const startRecording = useCallback(async () => {
    try {
      const { stop } = await startVoiceRecording();
      
      setIsRecording(true);
      setRecordingTime(0);
      setAudioLevel(0);
      setTranscription('');
      
      // 録音時間の計測
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      // 音声レベル監視開始
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startAudioLevelMonitoring(stream);
      
      // 停止処理の保存
      mediaRecorderRef.current = { stop } as any;
      
      addToast({
        type: 'info',
        message: '音声録音を開始しました。話しかけてください。'
      });
      
    } catch (error) {
      console.error('録音開始エラー:', error);
      addToast({
        type: 'error',
        message: 'マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。'
      });
    }
  }, [startVoiceRecording, startAudioLevelMonitoring, addToast]);

  // 録音停止
  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current) return;
    
    try {
      setIsRecording(false);
      
      // タイマーとアニメーションの停止
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      // オーディオコンテキストのクリーンアップ
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // 録音データの取得
      const audioBlob = await mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      
      addToast({
        type: 'info',
        message: '音声を解析中...'
      });
      
      // 位置情報の取得
      let location: { latitude: number; longitude: number } | undefined;
      
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: false
            });
          });
          
          location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
        } catch (geoError) {
          console.log('位置情報の取得に失敗:', geoError);
        }
      }
      
      // 音声検索の実行
      const result = await voiceSearch(audioBlob, 'ja', location);
      
      setSearchResults(result);
      setTranscription(result.transcribed_text || '');
      onResultsChange?.(result);
      
      addToast({
        type: 'success',
        message: `${result.spots?.length || 0}件のスポットが見つかりました`
      });
      
    } catch (error) {
      console.error('音声検索エラー:', error);
      addToast({
        type: 'error',
        message: '音声検索に失敗しました。もう一度お試しください。'
      });
    }
  }, [voiceSearch, onResultsChange, addToast]);

  // 録音時間のフォーマット
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // 検索結果のクリア
  const clearResults = useCallback(() => {
    setSearchResults(null);
    setTranscription('');
    setRecordingTime(0);
    setAudioLevel(0);
  }, []);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 音声録音エリア */}
      <Card variant="outlined" padding="lg">
        <div className="text-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            🎤 AI音声認識スポット検索
          </h3>
          <p className="text-sm text-gray-600">
            音声でスポットを検索できます。「東京タワー周辺のグルメスポット」など自然に話しかけてください
          </p>
        </div>

        {/* 録音コントロール */}
        <div className="text-center space-y-6">
          {/* 音声レベルビジュアライザー */}
          <div className="relative w-32 h-32 mx-auto">
            <div 
              className={`
                w-full h-full rounded-full border-4 transition-all duration-100
                ${isRecording 
                  ? 'border-red-500 bg-red-100 animate-pulse' 
                  : 'border-blue-500 bg-blue-100'
                }
              `}
              style={{
                transform: isRecording ? `scale(${1 + audioLevel / 200})` : 'scale(1)'
              }}
            >
              <div className="w-full h-full flex items-center justify-center">
                <svg 
                  className={`w-12 h-12 ${isRecording ? 'text-red-600' : 'text-blue-600'}`} 
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M12 1c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2s2-.9 2-2V3c0-1.1-.9-2-2-2zm-1 13v1c-3.31 0-6-2.69-6-6h2c0 2.21 1.79 4 4 4s4-1.79 4-4h2c0 3.31-2.69 6-6 6v1h4v2H7v-2h4z"/>
                </svg>
              </div>
            </div>
            
            {/* 音声レベルインジケーター */}
            {isRecording && (
              <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2">
                <div className="flex items-center space-x-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`
                        w-1 h-4 rounded-full transition-all duration-100
                        ${audioLevel > i * 20 ? 'bg-red-500' : 'bg-gray-300'}
                      `}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 録音時間表示 */}
          {isRecording && (
            <div className="text-2xl font-mono text-red-600">
              {formatTime(recordingTime)}
            </div>
          )}

          {/* 録音ボタン */}
          <div className="space-y-3">
            {!isRecording ? (
              <Button
                variant="primary"
                size="lg"
                onClick={startRecording}
                disabled={loading}
                leftIcon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 1c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2s2-.9 2-2V3c0-1.1-.9-2-2-2zm-1 13v1c-3.31 0-6-2.69-6-6h2c0 2.21 1.79 4 4 4s4-1.79 4-4h2c0 3.31-2.69 6-6 6v1h4v2H7v-2h4z"/>
                  </svg>
                }
              >
                録音開始
              </Button>
            ) : (
              <Button
                variant="danger"
                size="lg"
                onClick={stopRecording}
                leftIcon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                }
              >
                録音停止
              </Button>
            )}
            
            {searchResults && (
              <Button
                variant="outline"
                onClick={clearResults}
                disabled={loading || isRecording}
              >
                クリア
              </Button>
            )}
          </div>

          {/* 録音中のヒント */}
          {isRecording && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                💡 例: 「東京駅周辺の美味しいラーメン店」「浅草の観光スポット」
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 音声認識結果 */}
      {transcription && (
        <Card>
          <Card.Header title="🗣️ 認識された音声" />
          <Card.Body>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-900 font-medium">
                「{transcription}」
              </p>
              {searchResults && (
                <div className="mt-2 text-sm text-blue-700">
                  音声認識確信度: {Math.round((searchResults.confidence || 0) * 100)}%
                  {searchResults.audio_duration && (
                    <span className="ml-4">
                      録音時間: {searchResults.audio_duration.toFixed(1)}秒
                    </span>
                  )}
                </div>
              )}
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 検索結果 */}
      {searchResults && searchResults.spots && searchResults.spots.length > 0 && (
        <Card>
          <Card.Header title="🔍 検索結果" />
          <Card.Body>
            <div className="space-y-3">
              {searchResults.spots.map((spot, index) => (
                <div
                  key={index}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => onSpotSelect?.(spot)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-900">{spot.name}</h5>
                      {spot.description && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {spot.description}
                        </p>
                      )}
                      {spot.location && (
                        <p className="text-sm text-gray-500 mt-1">
                          📍 {spot.location.address}
                        </p>
                      )}
                      <div className="flex items-center mt-2 space-x-4 text-sm text-gray-600">
                        {spot.rating && (
                          <span>⭐ {spot.rating}</span>
                        )}
                        {spot.price_level && (
                          <span>💰 {spot.price_level}</span>
                        )}
                        {spot.relevance_score && (
                          <span>関連度: {Math.round(spot.relevance_score * 100)}%</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSpotSelect?.(spot);
                      }}
                    >
                      追加
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 検索結果なしの場合 */}
      {searchResults && searchResults.spots?.length === 0 && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🤔</div>
              <p>「{transcription}」に関連するスポットが見つかりませんでした</p>
              <p className="text-sm mt-1">別の表現でお試しください</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ローディング状態 */}
      {loading && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-8">
              <LoadingSpinner size={32} className="mx-auto mb-3" />
              <p className="text-gray-600">音声を解析中...</p>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default VoiceSearch;