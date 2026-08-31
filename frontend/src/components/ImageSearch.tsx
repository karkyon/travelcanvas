import React, { useState, useRef, useCallback } from 'react';
import { useSearch } from '../../hooks/useSearch';
import { useToast } from '../common/Toast';
import Button from '../common/Button';
import Card from '../common/Card';
import { LoadingSpinner } from '../common/LoadingSpinner';
import type { ImageSearchResult } from '../../types';

interface ImageSearchProps {
  onSpotSelect?: (spot: any) => void;
  onResultsChange?: (results: ImageSearchResult) => void;
  className?: string;
}

const ImageSearch: React.FC<ImageSearchProps> = ({
  onSpotSelect,
  onResultsChange,
  className = ''
}) => {
  const { imageSearch, loading, error } = useSearch();
  const { addToast } = useToast();
  
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<ImageSearchResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ファイル選択処理
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;

    const validFiles: File[] = [];
    const urls: string[] = [];

    Array.from(files).forEach(file => {
      // ファイル形式チェック
      if (!file.type.startsWith('image/')) {
        addToast({
          type: 'error',
          message: `${file.name} は画像ファイルではありません`
        });
        return;
      }

      // ファイルサイズチェック（10MB制限）
      if (file.size > 10 * 1024 * 1024) {
        addToast({
          type: 'error',
          message: `${file.name} のサイズが大きすぎます（10MB以下にしてください）`
        });
        return;
      }

      validFiles.push(file);
      urls.push(URL.createObjectURL(file));
    });

    // 最大20枚制限
    const totalFiles = selectedImages.length + validFiles.length;
    if (totalFiles > 20) {
      addToast({
        type: 'warning',
        message: '画像は最大20枚まで選択できます'
      });
      
      const allowedCount = 20 - selectedImages.length;
      validFiles.splice(allowedCount);
      urls.splice(allowedCount);
    }

    setSelectedImages(prev => [...prev, ...validFiles]);
    setPreviewUrls(prev => [...prev, ...urls]);
  }, [selectedImages.length, addToast]);

  // ドラッグ&ドロップ処理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  }, [handleFileSelect]);

  // ファイル入力変更
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
  }, [handleFileSelect]);

  // 画像削除
  const removeImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => {
      // URLを解放
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // 画像検索実行
  const handleSearch = useCallback(async () => {
    if (selectedImages.length === 0) {
      addToast({
        type: 'warning',
        message: '検索する画像を選択してください'
      });
      return;
    }

    try {
      // 位置情報を取得（可能であれば）
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

      // 最初の画像で検索（マルチ画像は将来の機能として残す）
      const result = await imageSearch(selectedImages[0], location);
      
      setSearchResults(result);
      onResultsChange?.(result);
      
      addToast({
        type: 'success',
        message: `${result.suggested_spots?.length || 0}件のスポットが見つかりました`
      });
      
    } catch (err) {
      console.error('画像検索エラー:', err);
      addToast({
        type: 'error',
        message: '画像検索に失敗しました。もう一度お試しください。'
      });
    }
  }, [selectedImages, imageSearch, onResultsChange, addToast]);

  // 検索結果クリア
  const clearResults = useCallback(() => {
    setSearchResults(null);
    setSelectedImages([]);
    setPreviewUrls(prev => {
      prev.forEach(url => URL.revokeObjectURL(url));
      return [];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // クリーンアップ
  React.useEffect(() => {
    return () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 画像アップロードエリア */}
      <Card variant="outlined" padding="lg">
        <div className="text-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            📷 AI画像認識スポット検索
          </h3>
          <p className="text-sm text-gray-600">
            写真をドラッグ&ドロップまたはクリックして選択してください
          </p>
        </div>

        {/* ドロップゾーン */}
        <div
          className={`
            border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200
            ${isDragging 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
            }
            cursor-pointer
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="space-y-4">
            <div className="text-6xl">📸</div>
            <div>
              <p className="text-lg font-medium text-gray-700">
                画像をドロップまたはクリックして選択
              </p>
              <p className="text-sm text-gray-500 mt-1">
                JPEG, PNG, WebP対応（最大20枚、各10MB以下）
              </p>
            </div>
            <Button variant="primary">
              ファイルを選択
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleInputChange}
          className="hidden"
        />
      </Card>

      {/* 選択された画像のプレビュー */}
      {selectedImages.length > 0 && (
        <Card>
          <Card.Header title={`選択された画像 (${selectedImages.length}枚)`} />
          <Card.Body>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
              {previewUrls.map((url, index) => (
                <div key={index} className="relative group">
                  <img
                    src={url}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-20 object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="primary"
                onClick={handleSearch}
                loading={loading}
                disabled={selectedImages.length === 0}
                leftIcon={
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                }
              >
                AI画像検索を開始
              </Button>
              
              <Button
                variant="outline"
                onClick={clearResults}
                disabled={loading}
              >
                クリア
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 検索結果 */}
      {searchResults && (
        <Card>
          <Card.Header title="🔍 認識結果" />
          <Card.Body>
            {/* 認識されたオブジェクト */}
            {searchResults.recognized_objects && searchResults.recognized_objects.length > 0 && (
              <div className="mb-6">
                <h4 className="font-semibold text-gray-900 mb-3">認識されたオブジェクト</h4>
                <div className="space-y-2">
                  {searchResults.recognized_objects.map((obj, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <div>
                        <span className="font-medium text-blue-900">{obj.name}</span>
                        <span className="text-sm text-blue-700 ml-2">
                          確信度: {Math.round(obj.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 推薦スポット */}
            {searchResults.suggested_spots && searchResults.suggested_spots.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">推薦スポット</h4>
                <div className="space-y-3">
                  {searchResults.suggested_spots.map((spot, index) => (
                    <div
                      key={index}
                      className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => onSpotSelect?.(spot)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900">{spot.name}</h5>
                          {spot.location && (
                            <p className="text-sm text-gray-500">
                              📍 {spot.location.address}
                            </p>
                          )}
                          <div className="flex items-center mt-2 text-sm text-gray-600">
                            <span>類似度: {Math.round(spot.similarity * 100)}%</span>
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
              </div>
            )}

            {/* 結果なしの場合 */}
            {searchResults.suggested_spots?.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">🤔</div>
                <p>関連するスポットが見つかりませんでした</p>
                <p className="text-sm mt-1">別の画像をお試しください</p>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* エラー表示 */}
      {error && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-4 text-red-600">
              <div className="text-2xl mb-2">⚠️</div>
              <p>{error}</p>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default ImageSearch;