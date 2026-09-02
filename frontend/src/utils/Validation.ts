/**
 * バリデーション関数ユーティリティ
 * フォームデータ、ユーザー入力の妥当性チェック
 */

import { VALIDATION_RULES, REGEX_PATTERNS, ERROR_MESSAGES } from '../config/constants';

// バリデーション結果の型定義
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface FieldValidationResult {
  isValid: boolean;
  error?: string;
}

// 基本的なバリデーション関数
export const isRequired = (value: any): FieldValidationResult => {
  const isValid = value !== null && value !== undefined && String(value).trim() !== '';
  return {
    isValid,
    error: isValid ? undefined : 'この項目は必須です'
  };
};

export const minLength = (value: string, min: number): FieldValidationResult => {
  const trimmedValue = value?.trim() || '';
  const isValid = trimmedValue.length >= min;
  return {
    isValid,
    error: isValid ? undefined : `${min}文字以上で入力してください`
  };
};

export const maxLength = (value: string, max: number): FieldValidationResult => {
  const trimmedValue = value?.trim() || '';
  const isValid = trimmedValue.length <= max;
  return {
    isValid,
    error: isValid ? undefined : `${max}文字以内で入力してください`
  };
};

export const pattern = (value: string, regex: RegExp, errorMessage: string): FieldValidationResult => {
  const trimmedValue = value?.trim() || '';
  const isValid = regex.test(trimmedValue);
  return {
    isValid,
    error: isValid ? undefined : errorMessage
  };
};

// メールアドレスバリデーション
export const validateEmail = (email: string): FieldValidationResult => {
  if (!email) {
    return { isValid: false, error: ERROR_MESSAGES.EMAIL_REQUIRED };
  }

  const trimmedEmail = email.trim();
  
  // 長さチェック
  if (trimmedEmail.length > VALIDATION_RULES.EMAIL.MAX_LENGTH) {
    return { 
      isValid: false, 
      error: `メールアドレスは${VALIDATION_RULES.EMAIL.MAX_LENGTH}文字以内で入力してください` 
    };
  }

  // フォーマットチェック
  if (!REGEX_PATTERNS.EMAIL.test(trimmedEmail)) {
    return { isValid: false, error: ERROR_MESSAGES.EMAIL_INVALID };
  }

  return { isValid: true };
};

// パスワードバリデーション
export const validatePassword = (password: string): FieldValidationResult => {
  if (!password) {
    return { isValid: false, error: 'パスワードは必須です' };
  }

  // 最小長チェック
  if (password.length < VALIDATION_RULES.PASSWORD.MIN_LENGTH) {
    return { isValid: false, error: ERROR_MESSAGES.PASSWORD_TOO_SHORT };
  }

  // 最大長チェック
  if (password.length > VALIDATION_RULES.PASSWORD.MAX_LENGTH) {
    return { 
      isValid: false, 
      error: `パスワードは${VALIDATION_RULES.PASSWORD.MAX_LENGTH}文字以内で入力してください` 
    };
  }

  // 強度チェック
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);

  if (VALIDATION_RULES.PASSWORD.REQUIRE_UPPERCASE && !hasUppercase) {
    return { isValid: false, error: 'パスワードには大文字を含めてください' };
  }

  if (VALIDATION_RULES.PASSWORD.REQUIRE_LOWERCASE && !hasLowercase) {
    return { isValid: false, error: 'パスワードには小文字を含めてください' };
  }

  if (VALIDATION_RULES.PASSWORD.REQUIRE_NUMBER && !hasNumber) {
    return { isValid: false, error: 'パスワードには数字を含めてください' };
  }

  return { isValid: true };
};

// ユーザー名バリデーション
export const validateUsername = (username: string): FieldValidationResult => {
  if (!username) {
    return { isValid: false, error: 'ユーザー名は必須です' };
  }

  const trimmedUsername = username.trim();

  // 長さチェック
  if (trimmedUsername.length < VALIDATION_RULES.USERNAME.MIN_LENGTH) {
    return { 
      isValid: false, 
      error: `ユーザー名は${VALIDATION_RULES.USERNAME.MIN_LENGTH}文字以上で入力してください` 
    };
  }

  if (trimmedUsername.length > VALIDATION_RULES.USERNAME.MAX_LENGTH) {
    return { 
      isValid: false, 
      error: `ユーザー名は${VALIDATION_RULES.USERNAME.MAX_LENGTH}文字以内で入力してください` 
    };
  }

  // パターンチェック
  if (!VALIDATION_RULES.USERNAME.PATTERN.test(trimmedUsername)) {
    return { isValid: false, error: ERROR_MESSAGES.USERNAME_INVALID };
  }

  return { isValid: true };
};

// プランタイトルバリデーション
export const validatePlanTitle = (title: string): FieldValidationResult => {
  if (!title) {
    return { isValid: false, error: ERROR_MESSAGES.TITLE_REQUIRED };
  }

  const trimmedTitle = title.trim();

  if (trimmedTitle.length < VALIDATION_RULES.PLAN_TITLE.MIN_LENGTH) {
    return { isValid: false, error: ERROR_MESSAGES.TITLE_REQUIRED };
  }

  if (trimmedTitle.length > VALIDATION_RULES.PLAN_TITLE.MAX_LENGTH) {
    return { isValid: false, error: ERROR_MESSAGES.TITLE_TOO_LONG };
  }

  return { isValid: true };
};

// 日付バリデーション
export const validateDate = (date: string, label: string = '日付'): FieldValidationResult => {
  if (!date) {
    return { isValid: false, error: `${label}は必須です` };
  }

  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    return { isValid: false, error: `${label}の形式が正しくありません` };
  }

  return { isValid: true };
};

export const validateDateRange = (startDate: string, endDate: string): FieldValidationResult => {
  const startResult = validateDate(startDate, '開始日');
  if (!startResult.isValid) {
    return startResult;
  }

  const endResult = validateDate(endDate, '終了日');
  if (!endResult.isValid) {
    return endResult;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    return { isValid: false, error: '終了日は開始日より後に設定してください' };
  }

  return { isValid: true };
};

// 時間バリデーション
export const validateTime = (time: string, label: string = '時間'): FieldValidationResult => {
  if (!time) {
    return { isValid: false, error: `${label}は必須です` };
  }

  // HH:MM形式のチェック
  const timePattern = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timePattern.test(time)) {
    return { isValid: false, error: `${label}は HH:MM 形式で入力してください` };
  }

  return { isValid: true };
};

export const validateTimeRange = (startTime: string, endTime: string): FieldValidationResult => {
  const startResult = validateTime(startTime, '開始時間');
  if (!startResult.isValid) {
    return startResult;
  }

  const endResult = validateTime(endTime, '終了時間');
  if (!endResult.isValid) {
    return endResult;
  }

  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  const startMinutes = (startHour ?? 0) * 60 + (startMin ?? 0);
  const endMinutes = (endHour ?? 0) * 60 + (endMin ?? 0);

  if (startMinutes >= endMinutes) {
    return { isValid: false, error: '終了時間は開始時間より後に設定してください' };
  }

  return { isValid: true };
};

// 数値バリデーション
export const validateNumber = (
  value: string | number, 
  min?: number, 
  max?: number,
  label: string = '数値'
): FieldValidationResult => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(numValue)) {
    return { isValid: false, error: `${label}は数値で入力してください` };
  }

  if (min !== undefined && numValue < min) {
    return { isValid: false, error: `${label}は${min}以上で入力してください` };
  }

  if (max !== undefined && numValue > max) {
    return { isValid: false, error: `${label}は${max}以下で入力してください` };
  }

  return { isValid: true };
};

// 予算バリデーション
export const validateBudget = (budget: string | number): FieldValidationResult => {
  return validateNumber(budget, 0, 10000000, '予算');
};

// 座標バリデーション
export const validateLatitude = (lat: string | number): FieldValidationResult => {
  const result = validateNumber(lat, -90, 90, '緯度');
  if (!result.isValid) {
    return result;
  }

  const latValue = typeof lat === 'string' ? parseFloat(lat) : lat;
  if (!REGEX_PATTERNS.LATITUDE.test(latValue.toString())) {
    return { isValid: false, error: '緯度の形式が正しくありません' };
  }

  return { isValid: true };
};

export const validateLongitude = (lng: string | number): FieldValidationResult => {
  const result = validateNumber(lng, -180, 180, '経度');
  if (!result.isValid) {
    return result;
  }

  const lngValue = typeof lng === 'string' ? parseFloat(lng) : lng;
  if (!REGEX_PATTERNS.LONGITUDE.test(lngValue.toString())) {
    return { isValid: false, error: '経度の形式が正しくありません' };
  }

  return { isValid: true };
};

// 電話番号バリデーション
export const validatePhoneNumber = (phone: string): FieldValidationResult => {
  if (!phone) {
    return { isValid: false, error: '電話番号は必須です' };
  }

  const trimmedPhone = phone.trim();
  
  if (!REGEX_PATTERNS.PHONE_NUMBER.test(trimmedPhone)) {
    return { isValid: false, error: '電話番号の形式が正しくありません' };
  }

  return { isValid: true };
};

// URLバリデーション
export const validateUrl = (url: string): FieldValidationResult => {
  if (!url) {
    return { isValid: false, error: 'URLは必須です' };
  }

  const trimmedUrl = url.trim();
  
  if (!REGEX_PATTERNS.URL.test(trimmedUrl)) {
    return { isValid: false, error: 'URLの形式が正しくありません' };
  }

  return { isValid: true };
};

// ファイルバリデーション
export const validateImageFile = (file: File): FieldValidationResult => {
  // ファイルタイプチェック
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { isValid: false, error: 'JPEG、PNG、WebP形式の画像ファイルを選択してください' };
  }

  // ファイルサイズチェック（10MB）
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return { isValid: false, error: 'ファイルサイズは10MB以下にしてください' };
  }

  return { isValid: true };
};

// 複合バリデーション関数
export const validateRegistrationForm = (data: {
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  fullName?: string;
}): ValidationResult => {
  const errors: string[] = [];

  // 各フィールドをバリデーション
  const emailResult = validateEmail(data.email);
  if (!emailResult.isValid) errors.push(emailResult.error!);

  const usernameResult = validateUsername(data.username);
  if (!usernameResult.isValid) errors.push(usernameResult.error!);

  const passwordResult = validatePassword(data.password);
  if (!passwordResult.isValid) errors.push(passwordResult.error!);

  // パスワード確認
  if (data.password !== data.confirmPassword) {
    errors.push('パスワードが一致しません');
  }

  // フルネーム（任意）
  if (data.fullName && data.fullName.trim().length > 100) {
    errors.push('氏名は100文字以内で入力してください');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validateLoginForm = (data: {
  emailOrUsername: string;
  password: string;
}): ValidationResult => {
  const errors: string[] = [];

  if (!data.emailOrUsername?.trim()) {
    errors.push('メールアドレスまたはユーザー名は必須です');
  }

  if (!data.password) {
    errors.push('パスワードは必須です');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validatePlanForm = (data: {
  title: string;
  startDate: string;
  endDate: string;
  budget?: number;
}): ValidationResult => {
  const errors: string[] = [];

  // タイトル
  const titleResult = validatePlanTitle(data.title);
  if (!titleResult.isValid) errors.push(titleResult.error!);

  // 日付範囲
  const dateRangeResult = validateDateRange(data.startDate, data.endDate);
  if (!dateRangeResult.isValid) errors.push(dateRangeResult.error!);

  // 予算（任意）
  if (data.budget !== undefined) {
    const budgetResult = validateBudget(data.budget);
    if (!budgetResult.isValid) errors.push(budgetResult.error!);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// カスタムバリデーション関数の型
export type CustomValidator<T> = (value: T) => FieldValidationResult;

// 複数のバリデーションを組み合わせる関数
export const combineValidators = <T>(
  value: T,
  validators: CustomValidator<T>[]
): FieldValidationResult => {
  for (const validator of validators) {
    const result = validator(value);
    if (!result.isValid) {
      return result;
    }
  }
  
  return { isValid: true };
};

// 配列の要素をバリデーション
export const validateArray = <T>(
  array: T[],
  itemValidator: CustomValidator<T>,
  minLength?: number,
  maxLength?: number
): ValidationResult => {
  const errors: string[] = [];

  // 配列長チェック
  if (minLength !== undefined && array.length < minLength) {
    errors.push(`最低${minLength}個の項目が必要です`);
  }

  if (maxLength !== undefined && array.length > maxLength) {
    errors.push(`最大${maxLength}個までの項目に制限されています`);
  }

  // 各要素をバリデーション
  array.forEach((item, index) => {
    const result = itemValidator(item);
    if (!result.isValid) {
      errors.push(`項目${index + 1}: ${result.error}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
};