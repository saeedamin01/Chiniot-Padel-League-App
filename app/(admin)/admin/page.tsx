'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatDate, formatDateTime, formatTimeAgo } from '@/lib/utils'
import { AlertTriangle, Plus, TrendingUp } from 'lucide-react'
import { Season, Challenge, LeagueSettings, AuditLog } from '@/types'

interface DashboardStats {
  totalTeams: number
  activeChallenges: number
  pendingResults: number
  frozenTeams: number
  seasonDaysRemaining: number
  totalPlayedToday: number
}

export default function AdminDashboard() {
  const supabase = createClient()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [season, setSeason] = useState<Season | null>(null)
  const [recentActivity, setRecentActivity] = useState<AuditLog[]>([])
  const [pendingChallenges, setPendingChallenges] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    try {
      setLoading(true)
      setError('')

      // Get active season
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('*')
        .eq('is_active', true)
        .single()

      if (!seasonData) {
        setError('No active season found')
        setLoading(false)
        return
      }

      setSeason(seasonData)

      // Get total teams
      const { count: teamCount } = await supabase
        .from('teams')
        .select('id', { count: 'exact' })
        .eq('season_id', seasonData.id)

      // Get frozen teams
      const { count: frozenCount } = await supabase
        .from('ladder_positions')
        .select('id', { count: 'exact' })
        .eq('season_id', seasonData.id)
        .eq('status', 'frozen')

      // Get active challenges
      const { data: activeChallengesData, count: challengeCount } = await supabase
        .from('challenges')
        .select('*', { count: 'exact' })
        .eq('season_id', seasonData.id)
        .in('status', ['pending', 'scheduled'])

      // Get pending results
      const { count: resultCount } = await supabase
        .from('match_results')
        .select('id', { count: 'exact' })
        .eq('season_id', seasonData.id)
        .is('verified_at', null)
        .eq('auto_verified', false)

      // Get played today count
      const today = new Date().toISOString().split('T')[0]
      const { count: todayCount } = await supabase
        .from('match_results')
        .select('id', { count: 'exact' })
        .eq('season_id', seasonData.id)
        .gte('created_at', `${today}T00:00:00`)

      // Get recent audit log
      const { data: auditData } = await supabase
        .from('audit_log')
        .select('*, actor:players!actor_id(*)')
        .eq('season_id', seasonData.id)
        .order('created_at', { ascending: false })
        .limit(10)

      // Calculate days remaining
      const endDate = new Date(seasonData.end_date)
      const today_date = new Date()
      const daysRemaining = Math.ceil((endDate.getTime() - today_date.getTime()) / (1000 * 60 * 60 * 24))

      setStats({
        totalTeams: teamCount || 0,
        activeChallenges: challengeCount || 0,
        pendingResults: resultCount || 0,
        frozenTeams: frozenCount || 0,
        seasonDaysRemaining: Math.max(0, daysRemaining),
        totalPlayedToday: todayCount || 0,
      })

      setPendingChallenges((activeChallengesData || []).slice(0, 5))
      setRecentActivity(auditData || [])
    } catch (err) {
      setError('Failed to load dashboard data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          {season && (
            <p className="text-slate-400 mt-1">
              {season.name} • {stats?.seasonDaysRemaining} days remaining
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <a href="/admin/teams">
              <Plus className="w-4 h-4 mr-2" />
              Add Team
            </a>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Key Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="text-sm font-medium text-slate-400">Total Teams</div>
            <div className="text-3xl font-bold text-white mt-2">{stats.totalTeams}</div>
            <div className="text-xs text-slate-500 mt-2">In this season</div>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="text-sm font-medium text-slate-400">Active Challenges</div>
            <div className="text-3xl font-bold text-emerald-400 mt-2">{stats.activeChallenges}</div>
            <div className="text-xs text-slate-500 mt-2">Pending & Scheduled</div>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="text-sm font-medium text-slate-400">Pending Results</div>
            <div className="text-3xl font-bold text-yellow-400 mt-2">{stats.pendingResults}</div>
            <div className="text-xs text-slate-500 mt-2">Awaiting verification</div>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="text-sm font-medium text-slate-400">Frozen Teams</div>
            <div className="text-3xl font-bold text-red-400 mt-2">{stats.frozenTeams}</div>
            <div className="text-xs text-slate-500 mt-2">Currently frozen</div>
          </Card>
        </div>
      )}

      {/* Challenge Health & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Challenges */}
        <Card className="bg-slate-800/60 border-slate-700">
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Pending Challenges
            </h2>
          </div>
          <div className="p-6">
            {pendingChallenges.length === 0 ? (
              <p className="text-slate-400 text-sm">No pending challenges</p>
            ) : (
              <div className="space-y-3">
                {pendingChallenges.slice(0, 5).map((challenge) => (
                  <div
                    key={challenge.id}
                    className="p-3 bg-slate-900/50 rounded-lg border border-slate-700 flex justify-between items-start"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {challenge.challenge_code}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Accept by {formatDateTime(challenge.accept_deadline)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">
                      {challenge.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <Button asChild variant="outline" className="w-full mt-4">
              <a href="/admin/challenges">View All Challenges</a>
            </Button>
          </div>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-slate-800/60 border-slate-700">
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
          </div>
          <div className="p-6">
            {recentActivity.length === 0 ? (
              <p className="text-slate-400 text-sm">No recent activity</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {recentActivity.map((log) => (
                  <div
                    key={log.id}
                    className="text-sm border-l-2 border-emerald-500/30 pl-3 py-1"
                  >
                    <div className="font-medium text-slate-200">
                      {log.action_type}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {log.actor_email} • {formatTimeAgo(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-slate-800/60 border-slate-700">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Quick Actions</h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <a href="/admin/teams">
              <Plus className="w-4 h-4 mr-2" />
              Add Team
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/admin/ladder">Manual Adjustment</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/admin/settings">Edit Settings</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/admin/audit">View Audit Log</a>
          </Button>
        </div>
      </Card>
    </div>
  )
}
