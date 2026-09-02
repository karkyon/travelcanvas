import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAuth?: boolean
  /** 必要なロール('admin'等)。未指定時はロールチェックを行わない */
  requireRole?: string
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requireAuth = true,
  requireRole
}) => {
  const { isAuthenticated, isLoading, user } = useAuthStore()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (requireAuth && !isAuthenticated) {
    // Redirect to login page with return url
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!requireAuth && isAuthenticated) {
    // Redirect authenticated users away from login/register pages
    return <Navigate to="/dashboard" replace />
  }

  // [Gate #7j] requireRoleがpropとして渡されていたが実装が存在せず、/adminが
  // 認証済みユーザーなら誰でも通過できる実害的なアクセス制御バグだった。
  if (requireRole && user?.user_type !== requireRole && user?.role !== requireRole) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
