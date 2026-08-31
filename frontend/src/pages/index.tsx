import { useState, useEffect } from 'react'
import { GetServerSideProps } from 'next'
import Head from 'next/head'

interface Travel {
  id: number
  title: string
  location: string
  duration: number
  estimated_cost: number
  optimized_route: boolean
  optimization_score: number
  transport_modes: string[]
  created_at: string
}

interface TravelsResponse {
  travels: Travel[]
  total: number
  optimized_count: number
}

interface HomeProps {
  travelsData: TravelsResponse
  initialError?: string
}

export default function Home({ travelsData, initialError }: HomeProps) {
  const [travels, setTravels] = useState<Travel[]>(travelsData?.travels || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError || null)
  const [optimizationStatus, setOptimizationStatus] = useState<Record<number, string>>({})

  const optimizeRoute = async (travel: Travel) => {
    setLoading(true)
    setError(null)
    setOptimizationStatus(prev => ({ ...prev, [travel.id]: 'optimizing' }))
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/optimize-route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-token' // Mock token
        },
        body: JSON.stringify({
          travel_id: travel.id,
          waypoints: ['Point A', 'Point B', 'Point C'],
          preferences: {
            transport_modes: travel.transport_modes,
            optimization_goal: 'cost_time_balance'
          }
        })
      })
      
      if (!response.ok) {
        throw new Error('Optimization failed')
      }
      
      const result = await response.json()
      console.log('Optimization result:', result)
      
      // Update travel list with optimization results
      setTravels(prev => prev.map(t => 
        t.id === travel.id 
          ? { 
              ...t, 
              optimized_route: true, 
              optimization_score: result.quick_result.optimization_score 
            }
          : t
      ))
      
      setOptimizationStatus(prev => ({ ...prev, [travel.id]: 'completed' }))
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setOptimizationStatus(prev => ({ ...prev, [travel.id]: 'failed' }))
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimizing': return 'text-blue-600'
      case 'completed': return 'text-green-600'
      case 'failed': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const formatTransportModes = (modes: string[]) => {
    const modeEmojis: Record<string, string> = {
      train: '🚆',
      bus: '🚌',
      walking: '🚶',
      metro: '🚇',
      bike: '🚴',
      taxi: '🚕',
      subway: '🚇'
    }
    return modes.map(mode => modeEmojis[mode] || mode).join(' ')
  }

  return (
    <>
      <Head>
        <title>TravelCanvas - AI-Powered Travel Planning (Unified Enhanced)</title>
        <meta name="description" content="Optimize your travel routes with AI and OR-Tools - Complete development environment" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="container mx-auto px-4 py-8">
          <header className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-800 mb-4">
              Travel<span className="text-blue-600">Canvas</span>
              <span className="text-sm text-gray-500 block mt-2">Unified Enhanced Development Environment</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              AI-powered travel planning with route optimization using OR-Tools, Docker, and complete CI/CD
            </p>
          </header>

          {error && (
            <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
              <p className="font-medium">Error: {error}</p>
            </div>
          )}

          {/* System Status */}
          <section className="mb-8 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">System Status</h2>
            <div className="grid md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl text-green-600">✅</div>
                <div className="text-sm text-gray-600">FastAPI Backend</div>
              </div>
              <div className="text-center">
                <div className="text-2xl text-green-600">✅</div>
                <div className="text-sm text-gray-600">PostgreSQL DB</div>
              </div>
              <div className="text-center">
                <div className="text-2xl text-green-600">✅</div>
                <div className="text-sm text-gray-600">Redis Cache</div>
              </div>
              <div className="text-center">
                <div className="text-2xl text-green-600">✅</div>
                <div className="text-sm text-gray-600">OR-Tools</div>
              </div>
            </div>
          </section>

          {/* Statistics */}
          <section className="mb-8 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Travel Statistics</h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{travelsData?.total || 0}</div>
                <div className="text-sm text-gray-600">Total Travels</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{travelsData?.optimized_count || 0}</div>
                <div className="text-sm text-gray-600">Optimized Routes</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600">
                  {travelsData?.total ? Math.round((travelsData.optimized_count / travelsData.total) * 100) : 0}%
                </div>
                <div className="text-sm text-gray-600">Optimization Rate</div>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-white rounded-lg shadow-md p-6 text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-2">Route Optimization</h3>
                <p className="text-gray-600">AI-powered route optimization using Google OR-Tools with multiple algorithms</p>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-6 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-2">Cost Optimization</h3>
                <p className="text-gray-600">Minimize travel costs while maximizing experiences with multi-objective optimization</p>
              </div>
              
              <div className="bg-white rounded-lg shadow-md p-6 text-center">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-2">Real-time Updates</h3>
                <p className="text-gray-600">Dynamic updates with real-time data, weather conditions, and traffic</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-3xl font-bold text-gray-800 mb-8 text-center">Your Travel Plans</h2>
            
            {travels.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg">No travel plans yet. Start planning your adventure!</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {travels.map(travel => (
                  <div key={travel.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-semibold text-gray-800">{travel.title}</h3>
                        {travel.optimized_route && (
                          <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                            Optimized
                          </span>
                        )}
                      </div>
                      
                      <p className="text-gray-600 mb-2">📍 {travel.location}</p>
                      <p className="text-gray-600 mb-2">📅 {travel.duration} days</p>
                      <p className="text-gray-600 mb-2">💰 ${travel.estimated_cost}</p>
                      <p className="text-gray-600 mb-4">🚌 {formatTransportModes(travel.transport_modes)}</p>
                      
                      {travel.optimization_score && (
                        <div className="mb-4">
                          <div className="flex justify-between text-sm text-gray-600 mb-1">
                            <span>Optimization Score</span>
                            <span>{Math.round(travel.optimization_score * 100)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full" 
                              style={{ width: `${travel.optimization_score * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      
                      <button
                        onClick={() => optimizeRoute(travel)}
                        disabled={loading || optimizationStatus[travel.id] === 'optimizing'}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {optimizationStatus[travel.id] === 'optimizing' ? 'Optimizing...' : 'Optimize Route'}
                      </button>
                      
                      {optimizationStatus[travel.id] && (
                        <p className={`text-sm mt-2 ${getStatusColor(optimizationStatus[travel.id])}`}>
                          Status: {optimizationStatus[travel.id]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <footer className="mt-16 text-center text-gray-600">
            <p>&copy; 2024 TravelCanvas. Powered by FastAPI, Next.js, PostgreSQL, Redis, Docker, and Google OR-Tools.</p>
            <p className="text-sm mt-2">Unified Enhanced Development Environment - Complete CI/CD Pipeline</p>
          </footer>
        </div>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps = async () => {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const response = await fetch(`${apiUrl}/api/v1/travels`, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`)
    }
    
    const travelsData = await response.json()
    
    return {
      props: {
        travelsData,
      },
    }
  } catch (error) {
    console.error('Error fetching travels:', error)
    
    return {
      props: {
        travelsData: { travels: [], total: 0, optimized_count: 0 },
        initialError: error instanceof Error ? error.message : 'Failed to fetch data'
      },
    }
  }
}
