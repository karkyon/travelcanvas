import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Suspense } from 'react'
import LoadingSpinner from '../components/common/LoadingSpinner'
import ProtectedRoute from '../components/auth/ProtectedRoute'
import ErrorBoundary from '../components/common/ErrorBoundary'

// Pages import
import LandingPage from '../pages/LandingPage'
import LoginPage from '../pages/LoginPage'
import RegisterPage from '../pages/RegisterPage'
import DashboardPage from '../pages/DashboardPage'
import PlannerPage from '../pages/PlannerPage'
import SearchPage from '../pages/SearchPage'
import OptimizationPage from '../pages/OptimizationPage'
import SharePage from '../pages/SharePage'
import SettingsPage from '../pages/SettingsPage'
import NotFoundPage from '../pages/NotFoundPage'

// Admin Pages
import AdminDashboard from '../pages/Admin/AdminDashboard'
import AdminUsers from '../pages/Admin/AdminUsers'

// Layout wrapper with loading and error boundary
const PageWrapper = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary>
    <Suspense fallback={<LoadingSpinner />}>
      {children}
    </Suspense>
  </ErrorBoundary>
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <PageWrapper><LandingPage /></PageWrapper>,
  },
  {
    path: '/login',
    element: <PageWrapper><LoginPage /></PageWrapper>,
  },
  {
    path: '/register',
    element: <PageWrapper><RegisterPage /></PageWrapper>,
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <PageWrapper><DashboardPage /></PageWrapper>
      </ProtectedRoute>
    ),
  },
  {
    path: '/planner/:planId?',
    element: <PageWrapper><PlannerPage /></PageWrapper>,
  },
  {
    path: '/search',
    element: <PageWrapper><SearchPage /></PageWrapper>,
  },
  {
    path: '/optimization/:planId',
    element: (
      <ProtectedRoute>
        <PageWrapper><OptimizationPage /></PageWrapper>
      </ProtectedRoute>
    ),
  },
  {
    path: '/share/:shareToken',
    element: <PageWrapper><SharePage /></PageWrapper>,
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <PageWrapper><SettingsPage /></PageWrapper>
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute requireRole="admin">
        <PageWrapper><AdminDashboard /></PageWrapper>
      </ProtectedRoute>
    ),
    children: [
      {
        path: 'users',
        element: (
          <ProtectedRoute requireRole="admin">
            <PageWrapper><AdminUsers /></PageWrapper>
          </ProtectedRoute>
        ),
      },
    ],
  },
  {
    path: '/404',
    element: <PageWrapper><NotFoundPage /></PageWrapper>,
  },
  {
    path: '*',
    element: <Navigate to="/404" replace />,
  },
])

export default router