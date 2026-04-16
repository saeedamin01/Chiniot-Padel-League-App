'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Calendar, CheckCircle } from 'lucide-react'
import { Season } from '@/types'
import { formatDate } from '@/lib/utils'

export default function SeasonsPage() {
  const supabase = createClient()
  const [seasons, setSeasons] = useState<Season[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    loadSeasons()
  }, [])

  async function loadSeasons() {
    setLoading(true)
    const { data, error } = await supabase
      .from('seasons')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else setSeasons(data || [])
    setLoading(false)
  }

  async function activateSeason(id: string) {
    setActionLoading(true)
    // Deactivate all, then activate selected
    await supabase.from('seasons').update({ is_active: false, status: 'completed' }).neq('id', id)
    const { error } = await supabase
      .from('seasons')
      .update({ is_active: true, status: 'active' })
      .eq('id', id)
    if (error) setError(error.message)
    else await loadSeasons()
    setActionLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-slate-400">Loading seasons...</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Season Management</h1>
          <p className="text-slate-400 mt-1">View and manage league seasons</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Seasons List */}
      <div className="space-y-4">
        {seasons.length === 0 ? (
          <Card className="bg-slate-800/60 border-slate-700 p-8 text-center">
            <p className="text-slate-400">No seasons found.</p>
          </Card>
        ) : (
          seasons.map((season) => (
            <Card key={season.id} className="bg-slate-800/60 border-slate-700 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-white">{season.name}</h2>
                      {season.is_active ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-400 border-slate-600">
                          {season.status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-6 mt-2 text-sm text-slate-400">
                      <span>Start: {formatDate(season.start_date)}</span>
                      <span>End: {formatDate(season.end_date)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {season.is_active ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Current Season
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading}
                      onClick={() => activateSeason(season.id)}
                    >
                      Set as Active
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Info Box */}
      <Card className="bg-slate-800/60 border-slate-700 p-6">
        <h3 className="text-white font-semibold mb-2">About Seasons</h3>
        <p className="text-slate-400 text-sm">
          Only one season can be active at a time. The active season is the one players compete in.
          Setting a new season as active will mark all other seasons as completed.
          New seasons are typically created at the start of each league cycle.
        </p>
      </Card>
    </div>
  )
}
