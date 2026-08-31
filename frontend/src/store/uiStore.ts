import { create } from 'zustand'

interface UIState {
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  currentPage: string
  isLoading: boolean
  notifications: Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
    timestamp: Date
  }>
  toggleTheme: () => void
  toggleSidebar: () => void
  setCurrentPage: (page: string) => void
  setLoading: (loading: boolean) => void
  addNotification: (notification: Omit<UIState['notifications'][0], 'id' | 'timestamp'>) => void
  removeNotification: (id: string) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'light',
  sidebarOpen: true,
  currentPage: 'dashboard',
  isLoading: false,
  notifications: [],

  toggleTheme: () => {
    set((state) => ({ 
      theme: state.theme === 'light' ? 'dark' : 'light' 
    }))
  },

  toggleSidebar: () => {
    set((state) => ({ 
      sidebarOpen: !state.sidebarOpen 
    }))
  },

  setCurrentPage: (page: string) => {
    set({ currentPage: page })
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading })
  },

  addNotification: (notification) => {
    const id = Math.random().toString(36).substr(2, 9)
    const newNotification = {
      ...notification,
      id,
      timestamp: new Date(),
    }
    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }))

    // Auto remove after 5 seconds
    setTimeout(() => {
      get().removeNotification(id)
    }, 5000)
  },

  removeNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }))
  },
}))
