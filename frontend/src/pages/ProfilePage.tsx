import React from 'react';
import { Navigate } from 'react-router-dom';

const ProfilePage: React.FC = () => {
  // SettingsPageにリダイレクト（プロフィール機能が含まれているため）
  return <Navigate to="/settings" replace />;
};

export default ProfilePage;