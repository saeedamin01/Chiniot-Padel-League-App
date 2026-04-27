'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Challenge, Team, MatchResult, DisputedScore } from '@/types'
import { formatDate, formatDateTime, formatTimeAgo, isDeadlineExpired, hoursUntilDeadline } from '@/lib/utils'
import { AlertTriangle, Trash2, Shield, RefreshCw, Check, X, Loader2, Calendar, MapPin, Pencil, Clock, History, Trophy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { EVENT_LABELS, EVENT_COLOURS } from '@/lib/challenges/events'

interface ChallengeEvent {
  id: string
  challenge_id: string
  event_type: string
  actor_id: string | null
  actor_role: 'player' | 'admin' | 'system'
  actor_name: string | null
  data: Record<string, unknown>
  created_at: string
}

interface ChallengeRow extends Challenge {
  challenging_team?: Team & { player1?: { name: string }; player2?: { name: string } }
  challenged_team?: Team & { player1?: { name: string }; player2?: { name: string } }
}

interface DisputedMatchRow {
  result_id: string
  challenge_id: string
  challenge_code: string
  challenging_team_name: string
  challenged_team_name: string
  reported_by_team_id: string
  original: {
    set1_challenger: number | undefined
    set1_challenged: number | undefined
    set2_challenger: number | undefined
    set2_challenged: number | undefined
    supertiebreak_challenger?: number | null
    supertiebreak_challenged?: number | null
    winner_team_id: string
    winner_name: string
  }
  disputed: DisputedScore & { winner_name: string }
  disputed_at: string
  dispute_flagged_at: string | null
}

export default function ChallengesPage() {
  const supabase = createClient()
  const [challenges, setChallenges] = useState<ChallengeRow[]>([])
  const [stats, setStats] = useState({
    pending: 0,
    scheduled: 0,
    overdue: 0,
    playedToday: 0,
    reschedulePending: 0,
  })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  // Reschedule approval state
  const [rescheduleNotes, setRescheduleNotes] = useState<Record<string, string>>({})
  const [rescheduleLoading, setRescheduleLoading] = useState<string | null>(null)

  // Edit modal state
  const [editChallenge, setEditChallenge] = useState<ChallengeRow | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [editNote, setEditNote] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editTab, setEditTab] = useState<'edit' | 'history'>('edit')
  const [editEvents, setEditEvents] = useState<ChallengeEvent[]>([])
  const [editEventsLoading, setEditEventsLoading] = useState(false)

  // Delete modal state
  const [deleteChallenge, setDeleteChallenge] = useState<ChallengeRow | null>(null)
  const [deleteNote, setDeleteNote] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Venues for edit form
  const [venues, setVenues] = useState<{ id: string; name: string; address?: string }[]>([])

  // Disputed matches
  const [disputedMatches, setDisputedMatches] = useState<DisputedMatchRow[]>([])
  const [disputeResolveLoading, setDisputeResolveLoading] = useState<string | null>(null)
  const [disputeForms, setDisputeForms] = useState<Record<string, {
    s1ch: string; s1cd: string; s2ch: string; s2cd: string; tbch: string; tbcd: string; winnerTeamId: string; note: string
  }>>({})

  useEffect(() => {
    loadChallenges()
    loadDisputedMatches()
  }, [])

  async function loadChallenges() {
    try {
      setLoading(true)

      // Get active season
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id')
        .eq('is_active', true)
        .single()

      if (!seasonData) {
        setLoading(false)
        return
      }

      // Get all challenges
      const { data: challengesData } = await supabase
        .from('challenges')
        .select(`
          *,
          challenging_team:teams!challenging_team_id(
            *,
            player1:players!player1_id(name),
            player2:players!player2_id(name)
          ),
          challenged_team:teams!challenged_team_id(
            *,
            player1:players!player1_id(name),
            player2:players!player2_id(name)
          )
        `)
        .eq('season_id', seasonData.id)
        .order('issued_at', { ascending: false })

      setChallenges(challengesData || [])

      // Calculate stats
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const pending = (challengesData || []).filter(c => c.status === 'pending').length
      const scheduled = (challengesData || []).filter(c => c.status === 'scheduled').length
      const overdue = (challengesData || []).filter(
        c => (c.status === 'pending' || c.status === 'scheduled') && isDeadlineExpired(c.accept_deadline)
      ).length
      const playedToday = (challengesData || []).filter(
        c => c.status === 'played' && c.updated_at?.startsWith(today)
      ).length
      const reschedulePending = (challengesData || []).filter(
        c => c.status === 'reschedule_pending_admin'
      ).length

      setStats({ pending, scheduled, overdue, playedToday, reschedulePending })

      // Load venues for edit form
      const { data: venueData } = await supabase
        .from('venues')
        .select('id, name, address')
        .eq('season_id', seasonData.id)
        .eq('is_active', true)
        .order('name')
      setVenues(venueData || [])
    } catch (err) {
      console.error('Error loading challenges:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadChallengeEvents(challengeId: string) {
    setEditEventsLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/events`)
      if (res.ok) {
        const data = await res.json()
        setEditEvents(data.events ?? [])
      }
    } catch (err) {
      console.error('Error fetching events:', err)
    } finally {
      setEditEventsLoading(false)
    }
  }

  // Open the edit modal pre-populated with current field values
  function openEdit(challenge: ChallengeRow) {
    const toLocal = (iso: string | null | undefined) => {
      if (!iso) return ''
      // datetime-local needs "YYYY-MM-DDTHH:MM"
      return new Date(iso).toISOString().slice(0, 16)
    }
    const toLocalDate = (iso: string | null | undefined) => {
      if (!iso) return ''
      return new Date(iso).toISOString().slice(0, 10)
    }
    setEditForm({
      status: challenge.status ?? '',
      accept_deadline: toLocal(challenge.accept_deadline),
      match_deadline: toLocalDate(challenge.match_deadline),
      confirmed_time: toLocal((challenge as any).confirmed_time),
      venue_id: (challenge as any).venue_id ?? '',
      slot_1: toLocal(challenge.slot_1),
      slot_2: toLocal(challenge.slot_2),
      slot_3: toLocal(challenge.slot_3),
      match_location: challenge.match_location ?? '',
    })
    setEditNote('')
    setEditTab('edit')
    setEditEvents([])
    setEditChallenge(challenge)
  }

  async function handleEditSave() {
    if (!editChallenge) return
    setEditLoading(true)
    try {
      // Convert local datetime strings back to ISO, empty → null
      const toISO = (v: string) => v ? new Date(v).toISOString() : null

      const body: Record<string, unknown> = {
        status: editForm.status || undefined,
        accept_deadline: toISO(editForm.accept_deadline),
        match_deadline: editForm.match_deadline ? new Date(editForm.match_deadline).toISOString() : null,
        confirmed_time: toISO(editForm.confirmed_time),
        venue_id: editForm.venue_id || null,
        slot_1: toISO(editForm.slot_1),
        slot_2: toISO(editForm.slot_2),
        slot_3: toISO(editForm.slot_3),
        match_location: editForm.match_location || null,
        adminNote: editNote || undefined,
      }

      const res = await fetch(`/api/admin/challenges/${editChallenge.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to update challenge'); return }

      setEditChallenge(null)
      loadChallenges()
    } catch (err) {
      console.error('Edit error:', err)
      alert('An error occurred')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteChallenge) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/admin/challenges/${deleteChallenge.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote: deleteNote || null }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to delete challenge'); return }

      setDeleteChallenge(null)
      setDeleteNote('')
      loadChallenges()
    } catch (err) {
      console.error('Delete error:', err)
      alert('An error occurred')
    } finally {
      setDeleteLoading(false)
    }
  }

  async function handleForceForfeit(challengeId: string, forfeitingTeamId: string) {
    if (!confirm('Force forfeit this challenge?')) return

    try {
      const response = await fetch(`/api/challenges/${challengeId}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forfeitingTeamId }),
      })

      if (!response.ok) {
        alert('Failed to forfeit challenge')
        return
      }

      loadChallenges()
    } catch (err) {
      console.error('Error forfeiting challenge:', err)
    }
  }

  async function handleRescheduleApproval(challengeId: string, action: 'approve' | 'reject') {
    setRescheduleLoading(challengeId + action)
    try {
      const res = await fetch(`/api/admin/challenges/${challengeId}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: rescheduleNotes[challengeId] || '' }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to process reschedule')
        return
      }
      setRescheduleNotes(prev => { const n = { ...prev }; delete n[challengeId]; return n })
      loadChallenges()
    } catch (err) {
      console.error('Reschedule approval error:', err)
      alert('An error occurred')
    } finally {
      setRescheduleLoading(null)
    }
  }

  async function handleDissolveChallenge(challengeId: string) {
    if (!confirm('Dissolve this challenge?')) return

    try {
      const response = await fetch(`/api/challenges/${challengeId}/dissolve`, {
        method: 'POST',
      })

      if (!response.ok) {
        alert('Failed to dissolve challenge')
        return
      }

      loadChallenges()
    } catch (err) {
      console.error('Error dissolving challenge:', err)
    }
  }

  async function loadDisputedMatches() {
    try {
      const { data: results } = await supabase
        .from('match_results')
        .select(`
          id,
          challenge_id,
          reported_by_team_id,
          winner_team_id,
          set1_challenger, set1_challenged,
          set2_challenger, set2_challenged,
          supertiebreak_challenger, supertiebreak_challenged,
          disputed_score,
          disputed_at,
          dispute_flagged_at,
          dispute_resolved_at,
          challenge:challenges(
            challenge_code,
            challenging_team_id,
            challenged_team_id,
            challenging_team:teams!challenging_team_id(name),
            challenged_team:teams!challenged_team_id(name)
          )
        `)
        .not('disputed_at', 'is', null)
        .is('dispute_resolved_at', null)
        .order('dispute_flagged_at', { ascending: false, nullsFirst: false })

      if (!results) return

      const rows: DisputedMatchRow[] = results.map((r: any) => {
        const ch = r.challenge
        const winnerIsChallenger = r.winner_team_id === ch.challenging_team_id
        const dsWinnerIsChallenger = r.disputed_score?.winner_team_id === ch.challenging_team_id
        return {
          result_id: r.id,
          challenge_id: r.challenge_id,
          challenge_code: ch.challenge_code,
          challenging_team_name: ch.challenging_team?.name ?? '—',
          challenged_team_name: ch.challenged_team?.name ?? '—',
          reported_by_team_id: r.reported_by_team_id,
          original: {
            set1_challenger: r.set1_challenger,
            set1_challenged: r.set1_challenged,
            set2_challenger: r.set2_challenger,
            set2_challenged: r.set2_challenged,
            supertiebreak_challenger: r.supertiebreak_challenger,
            supertiebreak_challenged: r.supertiebreak_challenged,
            winner_team_id: r.winner_team_id,
            winner_name: winnerIsChallenger ? ch.challenging_team?.name : ch.challenged_team?.name,
          },
          disputed: {
            ...r.disputed_score,
            winner_name: dsWinnerIsChallenger ? ch.challenging_team?.name : ch.challenged_team?.name,
          },
          disputed_at: r.disputed_at,
          dispute_flagged_at: r.dispute_flagged_at,
          challenging_team_id: ch.challenging_team_id,
          challenged_team_id: ch.challenged_team_id,
        } as any
      })
      setDisputedMatches(rows)
    } catch (err) {
      console.error('Error loading disputed matches:', err)
    }
  }

  function computeWinnerId(form: { s1ch: string; s1cd: string; s2ch: string; s2cd: string; tbch: string; tbcd: string }, chId: string, cdId: string): string {
    const s1ch = parseInt(form.s1ch) || 0
    const s1cd = parseInt(form.s1cd) || 0
    const s2ch = parseInt(form.s2ch) || 0
    const s2cd = parseInt(form.s2cd) || 0
    const challSetsWon = (s1ch > s1cd ? 1 : 0) + (s2ch > s2cd ? 1 : 0)
    const chdSetsWon = (s1cd > s1ch ? 1 : 0) + (s2cd > s2ch ? 1 : 0)
    if (challSetsWon > chdSetsWon) return chId
    if (chdSetsWon > challSetsWon) return cdId
    // Tied sets — supertiebreak decides
    const tbch = form.tbch ? parseInt(form.tbch) : null
    const tbcd = form.tbcd ? parseInt(form.tbcd) : null
    if (tbch != null && tbcd != null && tbch !== tbcd) return tbch > tbcd ? chId : cdId
    return '' // can't determine yet
  }

  async function handleAdminResolveDispute(resultId: string, challengeId: string, chId: string, cdId: string) {
    const form = disputeForms[resultId]
    if (!form) return
    if (!form.s1ch || !form.s1cd || !form.s2ch || !form.s2cd) {
      alert('Please fill in Set 1 and Set 2 scores.'); return
    }
    const winnerTeamId = computeWinnerId(form, chId, cdId)
    if (!winnerTeamId) {
      alert('Could not determine a winner from the scores — check the scores and add a supertiebreak if sets are split.'); return
    }

    setDisputeResolveLoading(resultId)
    try {
      const res = await fetch(`/api/matches/${resultId}/dispute/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'admin',
          set1Challenger: parseInt(form.s1ch), set1Challenged: parseInt(form.s1cd),
          set2Challenger: parseInt(form.s2ch), set2Challenged: parseInt(form.s2cd),
          supertiebreakChallenger: form.tbch ? parseInt(form.tbch) : null,
          supertiebreakChallenged: form.tbcd ? parseInt(form.tbcd) : null,
          winnerTeamId,
          adminNote: form.note || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to resolve dispute'); return }
      // Remove from local state
      setDisputedMatches(prev => prev.filter(d => d.result_id !== resultId))
      const newForms = { ...disputeForms }; delete newForms[resultId]; setDisputeForms(newForms)
      loadChallenges()
    } catch (err) {
      console.error('Resolve dispute error:', err)
      alert('An error occurred')
    } finally {
      setDisputeResolveLoading(null)
    }
  }

  const filteredChallenges = challenges.filter((c) => {
    if (filter === 'all') return true
    if (filter === 'overdue') return isDeadlineExpired(c.accept_deadline) && !['played', 'result_pending'].includes(c.status)
    return c.status === filter
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading challenges...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Challenge Oversight</h1>
        <p className="text-slate-400 mt-1">Manage and monitor all active challenges</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card className="bg-slate-800/60 border-slate-700 p-6">
          <div className="text-sm font-medium text-slate-400">Pending</div>
          <div className="text-3xl font-bold text-yellow-400 mt-2">{stats.pending}</div>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700 p-6">
          <div className="text-sm font-medium text-slate-400">Scheduled</div>
          <div className="text-3xl font-bold text-blue-400 mt-2">{stats.scheduled}</div>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700 p-6">
          <div className="text-sm font-medium text-slate-400">Overdue</div>
          <div className="text-3xl font-bold text-red-400 mt-2">{stats.overdue}</div>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700 p-6">
          <div className="text-sm font-medium text-slate-400">Played Today</div>
          <div className="text-3xl font-bold text-emerald-400 mt-2">{stats.playedToday}</div>
        </Card>
        <Card className={`p-6 ${stats.reschedulePending > 0 ? 'bg-purple-500/10 border-purple-500/50' : 'bg-slate-800/60 border-slate-700'}`}>
          <div className="text-sm font-medium text-slate-400">Reschedule Approvals</div>
          <div className={`text-3xl font-bold mt-2 ${stats.reschedulePending > 0 ? 'text-purple-400' : 'text-slate-500'}`}>{stats.reschedulePending}</div>
        </Card>
        <Card className={`p-6 ${disputedMatches.length > 0 ? 'bg-orange-500/10 border-orange-500/50' : 'bg-slate-800/60 border-slate-700'}`}>
          <div className="text-sm font-medium text-slate-400">Score Disputes</div>
          <div className={`text-3xl font-bold mt-2 ${disputedMatches.length > 0 ? 'text-orange-400' : 'text-slate-500'}`}>{disputedMatches.length}</div>
        </Card>
      </div>

      {/* ── Disputed Matches Section ── */}
      {disputedMatches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
            <h2 className="text-lg font-semibold text-white">Score Disputes — Awaiting Resolution</h2>
            <span className="text-xs bg-orange-500/20 text-orange-300 border border-orange-500/30 px-2 py-0.5 rounded-full">
              {disputedMatches.length}
            </span>
          </div>

          {disputedMatches.map(dm => {
            const form = disputeForms[dm.result_id] ?? { s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '', winnerTeamId: '', note: '' }
            const setForm = (patch: Partial<typeof form>) => setDisputeForms(prev => ({ ...prev, [dm.result_id]: { ...form, ...patch } }))
            const isLoading = disputeResolveLoading === dm.result_id
            const isFlagged = !!dm.dispute_flagged_at
            const chId = (dm as any).challenging_team_id
            const cdId = (dm as any).challenged_team_id

            return (
              <Card key={dm.result_id} className={`p-5 space-y-5 ${isFlagged ? 'bg-slate-800/60 border-orange-500/50' : 'bg-slate-800/60 border-orange-500/30'}`}>
                {/* Header */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <code className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded font-mono">{dm.challenge_code}</code>
                      <Link href={`/challenges/${dm.challenge_id}`} className="text-white hover:text-orange-300 font-semibold text-sm transition-colors">
                        {dm.challenging_team_name}
                      </Link>
                      <span className="text-slate-500 text-xs">vs</span>
                      <Link href={`/challenges/${dm.challenge_id}`} className="text-white hover:text-orange-300 font-semibold text-sm transition-colors">
                        {dm.challenged_team_name}
                      </Link>
                    </div>
                    <p className="text-xs text-slate-500">
                      Disputed {new Date(dm.disputed_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
                      at {new Date(dm.disputed_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      {isFlagged && (
                        <span className="ml-2 text-orange-400 font-medium">· Escalated — window expired</span>
                      )}
                    </p>
                  </div>
                  {isFlagged && (
                    <span className="flex items-center gap-1.5 text-xs text-orange-400 bg-orange-500/15 border border-orange-500/30 px-2 py-1 rounded-full shrink-0">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Needs admin
                    </span>
                  )}
                </div>

                {/* Both score versions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-700/40 border border-slate-600 rounded-lg space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Original — {dm.reported_by_team_id === chId ? dm.challenging_team_name : dm.challenged_team_name}
                    </p>
                    <div className="flex gap-3 text-sm text-slate-200 flex-wrap">
                      <span>S1: {dm.original.set1_challenger ?? '—'}–{dm.original.set1_challenged ?? '—'}</span>
                      <span>S2: {dm.original.set2_challenger ?? '—'}–{dm.original.set2_challenged ?? '—'}</span>
                      {dm.original.supertiebreak_challenger != null && (
                        <span>TB: {dm.original.supertiebreak_challenger}–{dm.original.supertiebreak_challenged}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <Trophy className="h-3 w-3" /> {dm.original.winner_name} wins
                    </div>
                  </div>

                  <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg space-y-2">
                    <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide">
                      Counter — {dm.reported_by_team_id === chId ? dm.challenged_team_name : dm.challenging_team_name}
                    </p>
                    <div className="flex gap-3 text-sm text-white flex-wrap">
                      <span>S1: {dm.disputed.set1_challenger}–{dm.disputed.set1_challenged}</span>
                      <span>S2: {dm.disputed.set2_challenger}–{dm.disputed.set2_challenged}</span>
                      {dm.disputed.supertiebreak_challenger != null && (
                        <span>TB: {dm.disputed.supertiebreak_challenger}–{dm.disputed.supertiebreak_challenged}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <Trophy className="h-3 w-3" /> {dm.disputed.winner_name} wins
                    </div>
                  </div>
                </div>

                {/* Admin final score form */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Set Final Score</p>

                  {/* Score entry table — columns = teams, rows = sets */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left text-[10px] text-slate-500 font-medium pb-2 w-20"></th>
                          <th className="text-center text-[10px] text-slate-300 font-semibold pb-2 px-1">
                            {dm.challenging_team_name}
                            <span className="ml-1 text-slate-500 font-normal">(challenger)</span>
                          </th>
                          <th className="text-center text-[10px] text-slate-300 font-semibold pb-2 px-1">
                            {dm.challenged_team_name}
                            <span className="ml-1 text-slate-500 font-normal">(challenged)</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="space-y-1">
                        {[
                          { label: 'Set 1', chKey: 's1ch', cdKey: 's1cd' },
                          { label: 'Set 2', chKey: 's2ch', cdKey: 's2cd' },
                          { label: 'Tiebreak', chKey: 'tbch', cdKey: 'tbcd' },
                        ].map(({ label, chKey, cdKey }) => (
                          <tr key={label}>
                            <td className="text-[10px] text-slate-500 py-1 pr-2">{label}</td>
                            <td className="px-1 py-1">
                              <input
                                type="number" min="0" max="99"
                                value={(form as any)[chKey]}
                                onChange={e => setForm({ [chKey]: e.target.value } as any)}
                                placeholder="—"
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-orange-500 h-9"
                              />
                            </td>
                            <td className="px-1 py-1">
                              <input
                                type="number" min="0" max="99"
                                value={(form as any)[cdKey]}
                                onChange={e => setForm({ [cdKey]: e.target.value } as any)}
                                placeholder="—"
                                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-orange-500 h-9"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Auto-computed winner */}
                  {(() => {
                    const autoWinnerId = computeWinnerId(form, chId, cdId)
                    const autoWinnerName = autoWinnerId === chId ? dm.challenging_team_name : autoWinnerId === cdId ? dm.challenged_team_name : null
                    return autoWinnerName ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                        <Trophy className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="text-sm text-emerald-300 font-medium">{autoWinnerName} wins</span>
                        <span className="text-xs text-slate-500">(auto-calculated from scores)</span>
                      </div>
                    ) : (form.s1ch && form.s1cd && form.s2ch && form.s2cd) ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                        <span className="text-xs text-amber-300">Sets are tied — enter tiebreak scores to determine winner</span>
                      </div>
                    ) : null
                  })()}

                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Admin note (logged)</label>
                    <input
                      type="text"
                      value={form.note}
                      onChange={e => setForm({ note: e.target.value })}
                      placeholder="e.g. Reviewed footage — confirmed challenger's score is correct"
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 h-9 placeholder-slate-500"
                    />
                  </div>

                  <Button
                    onClick={() => handleAdminResolveDispute(dm.result_id, dm.challenge_id, chId, cdId)}
                    disabled={isLoading || !form.s1ch || !form.s1cd || !form.s2ch || !form.s2cd || !computeWinnerId(form, chId, cdId)}
                    className="w-full bg-orange-500 hover:bg-orange-600 h-10"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                    Set Final Score &amp; Update Ladder
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Reschedule Approval Section ── */}
      {challenges.filter(c => c.status === 'reschedule_pending_admin').length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Reschedule Requests — Awaiting Approval</h2>
            <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full">
              {challenges.filter(c => c.status === 'reschedule_pending_admin').length}
            </span>
          </div>
          {challenges.filter(c => c.status === 'reschedule_pending_admin').map(challenge => (
            <Card key={challenge.id} className="bg-slate-800/60 border-purple-500/30 p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded font-mono">{challenge.challenge_code}</code>
                    <Link href={`/admin/teams/${challenge.challenging_team_id}`} className="text-white hover:text-emerald-300 font-semibold text-sm transition-colors">{challenge.challenging_team?.name}</Link>
                    <span className="text-slate-500 text-xs">vs</span>
                    <Link href={`/admin/teams/${challenge.challenged_team_id}`} className="text-white hover:text-emerald-300 font-semibold text-sm transition-colors">{challenge.challenged_team?.name}</Link>
                  </div>
                  <p className="text-xs text-slate-500">
                    {challenge.challenging_team?.player1?.name} &amp; {challenge.challenging_team?.player2?.name}
                    {' · '}
                    {challenge.challenged_team?.player1?.name} &amp; {challenge.challenged_team?.player2?.name}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-700/40 border border-slate-600 rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Current scheduled time</p>
                  {(challenge as any).original_confirmed_time ? (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      <p className="text-slate-300 text-sm">
                        {new Date((challenge as any).original_confirmed_time).toLocaleDateString('en-GB', {
                          weekday: 'short', day: 'numeric', month: 'short',
                        })}{' '}
                        at{' '}
                        {new Date((challenge as any).original_confirmed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm">—</p>
                  )}
                </div>
                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Proposed new time</p>
                  {(challenge as any).reschedule_proposed_time ? (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-purple-400 shrink-0" />
                      <p className="text-white font-medium text-sm">
                        {new Date((challenge as any).reschedule_proposed_time).toLocaleDateString('en-GB', {
                          weekday: 'short', day: 'numeric', month: 'short',
                        })}{' '}
                        at{' '}
                        {new Date((challenge as any).reschedule_proposed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm">—</p>
                  )}
                  {(challenge as any).reschedule_reason && (
                    <p className="text-slate-400 text-xs italic">"{(challenge as any).reschedule_reason}"</p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1.5">Admin note (optional — sent to both teams)</label>
                <input
                  type="text"
                  value={rescheduleNotes[challenge.id] || ''}
                  onChange={e => setRescheduleNotes(prev => ({ ...prev, [challenge.id]: e.target.value }))}
                  placeholder="e.g. Approved due to venue conflict"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 h-9 placeholder-slate-500"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handleRescheduleApproval(challenge.id, 'approve')}
                  disabled={!!rescheduleLoading}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 h-10 text-sm"
                >
                  {rescheduleLoading === challenge.id + 'approve'
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Check className="h-4 w-4 mr-2" />}
                  Approve Reschedule
                </Button>
                <Button
                  onClick={() => handleRescheduleApproval(challenge.id, 'reject')}
                  disabled={!!rescheduleLoading}
                  variant="outline"
                  className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10 h-10 text-sm"
                >
                  {rescheduleLoading === challenge.id + 'reject'
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <X className="h-4 w-4 mr-2" />}
                  Reject — Keep Original
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'scheduled', 'played', 'overdue'].map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className={filter === f ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {/* Challenges Table */}
      <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900/50 border-slate-700">
              <TableRow>
                <TableHead className="text-slate-300">Code</TableHead>
                <TableHead className="text-slate-300">Challenger</TableHead>
                <TableHead className="text-slate-300">Challenged</TableHead>
                <TableHead className="text-slate-300">Status</TableHead>
                <TableHead className="text-slate-300">Accept Deadline</TableHead>
                <TableHead className="text-slate-300">Match Deadline</TableHead>
                <TableHead className="text-slate-300 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredChallenges.map((challenge) => {
                const isOverdue = isDeadlineExpired(challenge.accept_deadline)
                const hoursLeft = hoursUntilDeadline(challenge.accept_deadline)

                return (
                  <TableRow
                    key={challenge.id}
                    className={`border-slate-700 ${isOverdue && !['played', 'result_pending'].includes(challenge.status) ? 'bg-red-500/5' : ''}`}
                  >
                    <TableCell className="font-mono text-white">
                      {challenge.challenge_code}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      <Link href={`/admin/teams/${challenge.challenging_team_id}`} className="text-white hover:text-emerald-300 font-medium transition-colors">
                        {challenge.challenging_team?.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {challenge.challenging_team?.player1?.name} + {challenge.challenging_team?.player2?.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      <Link href={`/admin/teams/${challenge.challenged_team_id}`} className="text-white hover:text-emerald-300 font-medium transition-colors">
                        {challenge.challenged_team?.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {challenge.challenged_team?.player1?.name} + {challenge.challenged_team?.player2?.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          challenge.status === 'pending'
                            ? 'secondary'
                            : challenge.status === 'scheduled'
                              ? 'default'
                              : challenge.status === 'played'
                                ? 'default'
                                : 'destructive'
                        }
                      >
                        {challenge.status}
                      </Badge>
                      {isOverdue && !['played', 'result_pending'].includes(challenge.status) && (
                        <Badge variant="destructive" className="ml-2">
                          Overdue
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      <div>{formatDateTime(challenge.accept_deadline)}</div>
                      {!isOverdue && !['played', 'result_pending'].includes(challenge.status) && (
                        <div className="text-xs text-slate-500 mt-1">
                          {hoursLeft}h remaining
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      {challenge.match_deadline ? (
                        <>
                          <div>{formatDate(challenge.match_deadline)}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {formatTimeAgo(challenge.match_deadline)}
                          </div>
                        </>
                      ) : (
                        'N/A'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Edit */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(challenge)}
                          className="text-blue-400 hover:bg-blue-400/10"
                          title="Edit challenge"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {/* Force forfeit (non-terminal) */}
                        {!['played', 'forfeited', 'dissolved'].includes(challenge.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleForceForfeit(challenge.id, challenge.challenged_team_id)}
                            className="text-orange-400 hover:bg-orange-400/10"
                            title="Challenged team forfeits"
                          >
                            <Shield className="w-4 h-4" />
                          </Button>
                        )}
                        {/* Delete */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setDeleteChallenge(challenge); setDeleteNote('') }}
                          className="text-red-400 hover:bg-red-400/10"
                          title="Delete challenge"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {filteredChallenges.length === 0 && (
        <Card className="bg-slate-800/60 border-slate-700 p-12 text-center">
          <div className="text-slate-400">No challenges found for this filter</div>
        </Card>
      )}

      {/* ── Edit Challenge Modal ── */}
      {editChallenge && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setEditChallenge(null) }}
        >
          <div className="w-full max-w-xl bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-slate-700">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Pencil className="h-4 w-4 text-blue-400" />
                  <h2 className="font-bold text-white text-lg">Edit Challenge</h2>
                </div>
                <p className="text-xs text-slate-400">
                  <code className="font-mono text-slate-300">{editChallenge.challenge_code}</code>
                  {' · '}
                  <span className="text-slate-500">Teams cannot be changed</span>
                </p>
              </div>
              <button onClick={() => setEditChallenge(null)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-slate-700">
              <button
                onClick={() => setEditTab('edit')}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                  editTab === 'edit'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Fields
              </button>
              <button
                onClick={() => {
                  setEditTab('history')
                  if (editEvents.length === 0) loadChallengeEvents(editChallenge.id)
                }}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                  editTab === 'history'
                    ? 'border-yellow-500 text-yellow-400'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
            </div>

            <div className="p-5 space-y-5">

              {/* ── History tab ── */}
              {editTab === 'history' && (
                <div className="space-y-1">
                  {editEventsLoading && (
                    <div className="flex items-center justify-center py-8 text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Loading history...
                    </div>
                  )}
                  {!editEventsLoading && editEvents.length === 0 && (
                    <div className="text-center py-10 text-slate-500 text-sm">
                      No events recorded yet.
                      <p className="text-xs mt-1 text-slate-600">Events are written when challenge actions occur (accept, score entry, etc.).</p>
                    </div>
                  )}
                  {!editEventsLoading && editEvents.length > 0 && (
                    <div className="relative">
                      {/* vertical line */}
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-700" />
                      <ul className="space-y-4 pl-10">
                        {editEvents.map((ev, idx) => {
                          const colour = EVENT_COLOURS[ev.event_type as keyof typeof EVENT_COLOURS] ?? 'slate'
                          const label = EVENT_LABELS[ev.event_type as keyof typeof EVENT_LABELS] ?? ev.event_type.replace(/_/g, ' ')
                          const dotColour = {
                            emerald: 'bg-emerald-500',
                            red: 'bg-red-500',
                            blue: 'bg-blue-500',
                            yellow: 'bg-yellow-500',
                            orange: 'bg-orange-500',
                            purple: 'bg-purple-500',
                            slate: 'bg-slate-500',
                          }[colour] ?? 'bg-slate-500'
                          const textColour = {
                            emerald: 'text-emerald-400',
                            red: 'text-red-400',
                            blue: 'text-blue-400',
                            yellow: 'text-yellow-400',
                            orange: 'text-orange-400',
                            purple: 'text-purple-400',
                            slate: 'text-slate-400',
                          }[colour] ?? 'text-slate-400'
                          return (
                            <li key={ev.id} className="relative">
                              {/* dot */}
                              <span className={`absolute -left-6 top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-800 ${dotColour}`} />
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm font-semibold ${textColour}`}>{label}</span>
                                  <span className="text-xs text-slate-500">
                                    {new Date(ev.created_at).toLocaleDateString('en-GB', {
                                      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                                    })}{' '}
                                    at{' '}
                                    {new Date(ev.created_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                                  {ev.actor_role === 'system' ? (
                                    <span className="text-slate-500 italic">System</span>
                                  ) : ev.actor_name ? (
                                    <span>{ev.actor_name} <span className="text-slate-600">({ev.actor_role})</span></span>
                                  ) : (
                                    <span className="text-slate-600 italic">Unknown</span>
                                  )}
                                </div>
                                {/* Extra data pill */}
                                {ev.data && Object.keys(ev.data).length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {Object.entries(ev.data)
                                      .filter(([k]) => !['actor_id','actor_name'].includes(k))
                                      .map(([k, v]) => (
                                        <span key={k} className="text-[10px] bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                                          {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                        </span>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Edit tab ── */}
              {editTab === 'edit' && <>

              {/* Read-only team row */}
              <div className="flex items-center gap-3 p-3 bg-slate-700/30 border border-slate-700/50 rounded-xl text-sm">
                <div className="flex-1 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Challenger</p>
                  <p className="font-medium text-white">{editChallenge.challenging_team?.name}</p>
                </div>
                <span className="text-slate-600">vs</span>
                <div className="flex-1 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Challenged</p>
                  <p className="font-medium text-white">{editChallenge.challenged_team?.name}</p>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Status</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 h-10"
                >
                  {[
                    'pending', 'accepted', 'accepted_open', 'time_pending_confirm',
                    'reschedule_requested', 'reschedule_pending_admin',
                    'scheduled', 'result_pending', 'played', 'forfeited', 'dissolved',
                  ].map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              {/* Deadlines row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Accept Deadline</label>
                  <input
                    type="datetime-local"
                    value={editForm.accept_deadline}
                    onChange={e => setEditForm(f => ({ ...f, accept_deadline: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-10"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Match Deadline</label>
                  <input
                    type="date"
                    value={editForm.match_deadline}
                    onChange={e => setEditForm(f => ({ ...f, match_deadline: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-10"
                  />
                </div>
              </div>

              {/* Confirmed time + Venue */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Confirmed Time</label>
                  <input
                    type="datetime-local"
                    step="1800"
                    value={editForm.confirmed_time}
                    onChange={e => setEditForm(f => ({ ...f, confirmed_time: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-10"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Venue</label>
                  <select
                    value={editForm.venue_id}
                    onChange={e => setEditForm(f => ({ ...f, venue_id: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-10"
                  >
                    <option value="">None</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Proposed Slots */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Proposed Slots (Challenger's suggestions)</label>
                <div className="space-y-2">
                  {(['slot_1', 'slot_2', 'slot_3'] as const).map((s, i) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-10 shrink-0">Slot {i + 1}</span>
                      <input
                        type="datetime-local"
                        step="1800"
                        value={editForm[s]}
                        onChange={e => setEditForm(f => ({ ...f, [s]: e.target.value }))}
                        className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-9"
                      />
                      {editForm[s] && (
                        <button onClick={() => setEditForm(f => ({ ...f, [s]: '' }))} className="text-slate-500 hover:text-slate-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Match location (text fallback) */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Match Location (text fallback)</label>
                <Input
                  value={editForm.match_location}
                  onChange={e => setEditForm(f => ({ ...f, match_location: e.target.value }))}
                  placeholder="e.g. Court 3 at Sports Hub"
                  className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                />
              </div>

              {/* Admin note */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Admin Note (logged, not shown to teams)</label>
                <Input
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="Reason for this edit..."
                  className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleEditSave}
                  disabled={editLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 h-10"
                >
                  {editLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
                <Button
                  onClick={() => setEditChallenge(null)}
                  variant="outline"
                  className="h-10 px-5 border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
              </div>

              </> /* end editTab === 'edit' */}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Challenge Modal ── */}
      {deleteChallenge && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget && !deleteLoading) setDeleteChallenge(null) }}
        >
          <Card className="w-full max-w-sm bg-slate-800 border-red-500/50 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-lg leading-tight">Delete Challenge?</h3>
                <p className="text-slate-400 text-sm mt-0.5">This is permanent and cannot be undone.</p>
              </div>
            </div>

            <div className="p-3 bg-slate-700/40 border border-slate-700 rounded-lg text-sm space-y-1">
              <p className="font-mono text-slate-300 font-semibold">{deleteChallenge.challenge_code}</p>
              <p className="text-slate-400">
                {deleteChallenge.challenging_team?.name} vs {deleteChallenge.challenged_team?.name}
              </p>
              <p className="text-slate-500 capitalize">Status: {deleteChallenge.status.replace(/_/g, ' ')}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Reason (will be recorded in audit log)</label>
              <Input
                value={deleteNote}
                onChange={e => setDeleteNote(e.target.value)}
                placeholder="e.g. duplicate entry, test data..."
                className="bg-slate-700 border-slate-600 text-white h-9 text-sm"
                disabled={deleteLoading}
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 h-10"
              >
                {deleteLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Delete Permanently
              </Button>
              <Button
                onClick={() => { if (!deleteLoading) { setDeleteChallenge(null); setDeleteNote('') } }}
                variant="outline"
                className="h-10 px-4 border-slate-600 text-slate-300"
                disabled={deleteLoading}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
