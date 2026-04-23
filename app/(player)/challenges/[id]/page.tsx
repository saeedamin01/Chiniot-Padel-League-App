'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  MapPin,
  ArrowRight,
  Loader2,
  AlertCircle,
  Trophy,
  AlertTriangle,
  RefreshCw,
  Check,
  X,
  Flag,
  History,
  MessageCircle,
  Phone,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react'
import { EVENT_LABELS, EVENT_COLOURS } from '@/lib/challenges/events'
import { DateTimeSlotPicker } from '@/components/ui/DateTimeSlotPicker'

interface ChallengeEvent {
  id: string
  event_type: string
  actor_role: 'player' | 'admin' | 'system'
  actor_name: string | null
  data: Record<string, unknown>
  created_at: string
}
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { VenuePicker } from '@/components/ui/VenuePicker'
import type { Challenge, Team, MatchResult, Venue } from '@/types'

interface PlayerContact {
  name: string
  phone?: string | null
}

interface DetailedChallenge extends Omit<Challenge, 'challenging_team' | 'challenged_team'> {
  challenging_team?: Team & { player1?: PlayerContact; player2?: PlayerContact }
  challenged_team?: Team & { player1?: PlayerContact; player2?: PlayerContact }
  match_result?: MatchResult
  proposed_slot?: string | null
  proposed_location?: string | null
  // Reschedule fields (present in DB but not on base Challenge type)
  reschedule_requested_by?: string | null
  reschedule_proposed_time?: string | null
  reschedule_reason?: string | null
  // Tracks which team submitted the time in accepted_open → the OTHER team confirms
  time_submitted_by_team_id?: string | null
}

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(deadline: string | null) {
  const [remaining, setRemaining] = useState<number>(0)

  useEffect(() => {
    if (!deadline) return
    const target = new Date(deadline).getTime()

    const tick = () => {
      const diff = target - Date.now()
      setRemaining(Math.max(0, diff))
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [deadline])

  const hours = Math.floor(remaining / (1000 * 60 * 60))
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000)
  const expired = remaining === 0

  return { hours, minutes, seconds, expired, remaining }
}

function CountdownDisplay({ deadline, label }: { deadline: string | null; label: string }) {
  const { hours, minutes, seconds, expired } = useCountdown(deadline)

  if (!deadline) return null

  const isUrgent = !expired && hours < 2
  const colorClass = expired
    ? 'text-red-400'
    : isUrgent
    ? 'text-orange-400'
    : 'text-emerald-400'

  return (
    <div className={`text-center ${colorClass}`}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {expired ? (
        <p className="font-bold text-sm">Expired</p>
      ) : (
        <p className="font-mono font-bold text-lg">
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ChallengeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const challengeId = params.id as string
  const [loading, setLoading] = useState(true)
  const [challenge, setChallenge] = useState<DetailedChallenge | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [userTeamIds, setUserTeamIds] = useState<string[]>([])

  // Accept flow state (Option 1 = open, Option 2 = slot)
  const [acceptOption, setAcceptOption] = useState<'open' | 'slot' | null>(null)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])

  // Set-time state (Option 1: Team B enters time after accepted_open)
  const [setTimeInput, setSetTimeInput] = useState('')
  const [setTimeVenueId, setSetTimeVenueId] = useState('')

  // Add venue later state
  const [showAddVenue, setShowAddVenue] = useState(false)
  const [addVenueId, setAddVenueId] = useState('')
  const [addVenueLoading, setAddVenueLoading] = useState(false)
  const [addVenuesList, setAddVenuesList] = useState<Venue[]>([])

  // Reschedule state
  const [showRescheduleForm, setShowRescheduleForm] = useState(false)
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [rescheduleVenueId, setRescheduleVenueId] = useState('')
  const [rescheduleReason, setRescheduleReason] = useState('')

  // Decline confirmation
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false)

  // Forfeit confirmation
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false)
  const [forfeiting, setForfeiting] = useState(false)

  // Event timeline
  const [events, setEvents] = useState<ChallengeEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)

  // Inline score entry
  const [scoreModalOpen, setScoreModalOpen] = useState(false)
  const [scoreState, setScoreState] = useState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
  const [scoreSubmitting, setScoreSubmitting] = useState(false)

  // Dispute flow
  const [disputeModalOpen, setDisputeModalOpen] = useState(false)
  const [disputeScore, setDisputeScore] = useState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
  const [disputeSubmitting, setDisputeSubmitting] = useState(false)
  const [acceptDisputeLoading, setAcceptDisputeLoading] = useState(false)

  // Chat
  const [chatId, setChatId] = useState<string | null>(null)
  const [slotsOpen, setSlotsOpen] = useState(false)

  const supabase = createClient()

  const fetchChallenge = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        toast.error('Authentication required')
        router.push('/login')
        return
      }

      const { data: season } = await supabase
        .from('seasons')
        .select('id')
        .eq('is_active', true)
        .single()

      if (season) {
        const { data: userTeams } = await supabase
          .from('teams')
          .select('id')
          .eq('season_id', season.id)
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

        setUserTeamIds(userTeams?.map((t) => t.id) || [])
      }

      const { data: challengeData, error } = await supabase
        .from('challenges')
        .select(`
          *,
          challenging_team:teams!challenging_team_id(
            *,
            player1:players!player1_id(*),
            player2:players!player2_id(*)
          ),
          challenged_team:teams!challenged_team_id(
            *,
            player1:players!player1_id(*),
            player2:players!player2_id(*)
          ),
          match_result:match_results!challenge_id(*)
        `)
        .eq('id', challengeId)
        .single()

      if (error || !challengeData) {
        console.error('Challenge detail fetch error:', error)
        toast.error('Challenge not found')
        router.push('/challenges')
        return
      }

      // Trigger auto-confirm server-side if the confirmation window has expired.
      // Covers both 'accepted' (legacy slot-pick) and 'time_pending_confirm' (open-accept flow).
      if (
        ['accepted', 'time_pending_confirm'].includes(challengeData?.status ?? '') &&
        challengeData?.confirmation_deadline
      ) {
        const deadline = new Date(challengeData.confirmation_deadline)
        if (deadline <= new Date()) {
          // Fire-and-forget — page will re-fetch with updated status
          fetch(`/api/challenges/${challengeId}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm' }),
          }).catch(() => {})
        }
      }

      // Auto-flag disputes whose window has expired (fire-and-forget)
      const mr0 = Array.isArray(challengeData.match_result)
        ? challengeData.match_result[0]
        : challengeData.match_result
      if (mr0?.disputed_at && !mr0?.dispute_resolved_at && !mr0?.dispute_flagged_at) {
        fetch(`/api/matches/${mr0.id}/dispute/flag`, { method: 'POST' }).catch(() => {})
      }

      // Normalise 1-to-many PostgREST arrays
      const normalized: DetailedChallenge = {
        ...challengeData,
        match_result: Array.isArray(challengeData.match_result)
          ? challengeData.match_result[0] ?? undefined
          : challengeData.match_result ?? undefined,
        venue: undefined,
      }

      // Fetch venue separately if assigned (avoids FK join ambiguity)
      if (challengeData.venue_id) {
        const { data: venueData } = await supabase
          .from('venues')
          .select('*')
          .eq('id', challengeData.venue_id)
          .single()
        if (venueData) normalized.venue = venueData
      }

      setChallenge(normalized)

      // Look up (or lazily create) the chat room for this challenge.
      // The API endpoint creates the chat if it doesn't exist yet — this handles
      // challenges accepted before the chat migration was applied, or any timing
      // gaps where the accept route's chat creation failed silently.
      const ACCEPTED_STATUSES = ['accepted_open', 'accepted', 'time_pending_confirm', 'revision_proposed', 'reschedule_requested', 'reschedule_pending_admin', 'scheduled', 'result_pending', 'played', 'forfeited']
      if (ACCEPTED_STATUSES.includes(normalized.status)) {
        try {
          const chatRes = await fetch(`/api/chat/challenge/${challengeId}`)
          if (chatRes.ok) {
            const chatData = await chatRes.json()
            if (chatData.chatId) setChatId(chatData.chatId)
          }
        } catch {
          // Non-fatal — chat button just won't show
        }
      }

      // Load active venues for accept form (pending) and for add-location / reschedule forms
      if (!['result_pending', 'played', 'forfeited', 'dissolved'].includes(normalized.status)) {
        const { data: venueData } = await supabase
          .from('venues')
          .select('*')
          .eq('season_id', normalized.season_id)
          .eq('is_active', true)
          .order('name')
        setVenues(venueData || [])
        setAddVenuesList(venueData || [])
      }
    } catch (err) {
      console.error('Error fetching challenge:', err)
      toast.error('Failed to load challenge')
      router.push('/challenges')
    } finally {
      setLoading(false)
    }
  }, [challengeId, router, supabase])

  useEffect(() => {
    fetchChallenge()
  }, [fetchChallenge])

  async function fetchEvents() {
    if (events.length > 0) return // already loaded
    setEventsLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/events`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events ?? [])
      }
    } catch (err) {
      console.error('Error fetching events:', err)
    } finally {
      setEventsLoading(false)
    }
  }

  // ── Accept: Option 1 (open) or Option 2 (pick slot) ─────────────────────
  const handleAccept = async () => {
    if (!challenge || !acceptOption) return

    if (acceptOption === 'slot' && selectedSlotIndex === null) {
      toast.error('Please select one of the suggested time slots')
      return
    }

    setActionLoading(true)
    try {
      const body = acceptOption === 'open'
        ? { acceptMode: 'open' }
        : { acceptMode: 'slot', slotIndex: selectedSlotIndex }

      const res = await fetch(`/api/challenges/${challengeId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to accept challenge'); return }

      toast.success(
        acceptOption === 'open'
          ? 'Challenge accepted! Agree on a time over WhatsApp, then enter it here.'
          : 'Slot selected — match is now confirmed and scheduled!'
      )
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Set time: either team enters the agreed time in accepted_open ────────
  const handleSetTime = async () => {
    if (!setTimeInput) { toast.error('Please enter the agreed match time'); return }
    if (!setTimeVenueId) { toast.error('Please select a venue'); return }
    const d = new Date(setTimeInput)
    if (d.getMinutes() % 30 !== 0) { toast.error('Time must be on a :00 or :30 boundary'); return }

    setActionLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/set-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedTime: d.toISOString(), venueId: setTimeVenueId }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to set time'); return }
      toast.success('Time submitted! The other team has been notified to confirm.')
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Reschedule request ────────────────────────────────────────────────────
  const handleRescheduleRequest = async () => {
    if (!rescheduleTime) { toast.error('Please enter a proposed time'); return }
    const d = new Date(rescheduleTime)
    if (d.getMinutes() % 30 !== 0) { toast.error('Time must be on a :00 or :30 boundary'); return }

    setActionLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposedTime: d.toISOString(),
          proposedVenueId: rescheduleVenueId || null,
          reason: rescheduleReason || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to request reschedule'); return }
      toast.success('Reschedule request sent to the other team.')
      setShowRescheduleForm(false)
      setRescheduleTime(''); setRescheduleVenueId(''); setRescheduleReason('')
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Reschedule confirm / decline ──────────────────────────────────────────
  const handleRescheduleRespond = async (action: 'confirm' | 'decline') => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/reschedule/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed'); return }
      toast.success(action === 'confirm' ? 'Reschedule agreed — awaiting admin approval.' : 'Reschedule declined. Match stays at original time.')
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Add venue later (Option A: slot was chosen, no venue set yet) ──────────
  const handleAddVenue = async () => {
    if (!addVenueId) {
      toast.error('Please select a venue')
      return
    }
    setAddVenueLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/venue`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: addVenueId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update venue')
        return
      }
      toast.success('Venue added!')
      setShowAddVenue(false)
      setAddVenueId('')
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setAddVenueLoading(false)
    }
  }

  // ── Confirm/Dispute: challenging team responds to accepted challenge ───────
  const handleConfirmChallenge = async (action: 'confirm' | 'dispute') => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to process confirmation')
        return
      }
      if (action === 'confirm') {
        toast.success('Match confirmed and officially scheduled!')
      } else {
        toast.success('Time disputed — the other team will re-enter the agreed time.')
      }
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Decline (forfeit) ──────────────────────────────────────────────────────
  const handleDecline = async () => {
    if (!challenge) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to decline challenge')
        return
      }
      toast.success('Challenge declined — this counts as a forfeit.')
      router.push('/challenges')
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
      setShowDeclineConfirm(false)
    }
  }

  // ── Forfeit ───────────────────────────────────────────────────────────────────
  const handleForfeit = async () => {
    if (!challenge) return
    const myTeamId = userTeamIds.find(id =>
      id === challenge.challenging_team_id || id === challenge.challenged_team_id
    )
    if (!myTeamId) return
    setForfeiting(true)
    try {
      const res = await fetch(`/api/challenges/${challengeId}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forfeitingTeamId: myTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to forfeit'); return }
      toast.success('Challenge forfeited.')
      router.push('/challenges')
    } catch {
      toast.error('An error occurred')
    } finally {
      setForfeiting(false)
      setShowForfeitConfirm(false)
    }
  }

  // ── Verify / Dispute result ────────────────────────────────────────────────
  const handleVerify = async (action: 'verify' | 'dispute') => {
    if (!challenge?.match_result) return
    // Determine which of the user's teams is the verifying (non-reporting) team
    const mr = challenge.match_result
    const verifyingTeamId = userTeamIds.find(id =>
      (id === challenge.challenging_team_id || id === challenge.challenged_team_id) &&
      id !== mr.reported_by_team_id
    )
    if (!verifyingTeamId) {
      toast.error('Could not determine your team')
      return
    }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/matches/${mr.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamId: verifyingTeamId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to process verification')
        return
      }
      if (action === 'verify') {
        toast.success('Result verified! Rankings have been updated.')
      } else {
        toast.success('Result disputed — an admin will review.')
      }
      await fetchChallenge()
    } catch {
      toast.error('An error occurred')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Submit score ───────────────────────────────────────────────────────────
  const handleSubmitScore = async () => {
    if (!challenge) return
    const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = scoreState
    if (!s1ch || !s1cd || !s2ch || !s2cd) { toast.error('Enter scores for both sets'); return }

    const n = (v: string) => parseInt(v, 10)
    const set1ChWon = n(s1ch) > n(s1cd)
    const set2ChWon = n(s2ch) > n(s2cd)
    const chSets = (set1ChWon ? 1 : 0) + (set2ChWon ? 1 : 0)
    const cdSets = ((!set1ChWon) ? 1 : 0) + ((!set2ChWon) ? 1 : 0)
    const needsTB = chSets === 1 && cdSets === 1
    if (needsTB && (!tbch || !tbcd)) { toast.error('Sets are 1-1 — enter the super tiebreak scores'); return }

    const reportingTeamId = userTeamIds.find(id =>
      id === challenge.challenging_team_id || id === challenge.challenged_team_id
    )
    if (!reportingTeamId) { toast.error('Could not determine your team'); return }

    const winnerTeamId = chSets >= 2
      ? challenge.challenging_team_id
      : needsTB
        ? (n(tbch) > n(tbcd) ? challenge.challenging_team_id : challenge.challenged_team_id)
        : challenge.challenged_team_id

    setScoreSubmitting(true)
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.id,
          reportingTeamId,
          winnerTeamId,
          set1Challenger: n(s1ch), set1Challenged: n(s1cd),
          set2Challenger: n(s2ch), set2Challenged: n(s2cd),
          supertiebreakChallenger: needsTB ? n(tbch) : null,
          supertiebreakChallenged: needsTB ? n(tbcd) : null,
          matchDate: (challenge.confirmed_time ?? challenge.match_date ?? challenge.accepted_slot) || new Date().toISOString(),
          matchLocation: venueObj?.name || challenge.match_location || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to submit score'); return }
      toast.success('Score submitted! Waiting for opponent to verify.')
      setScoreModalOpen(false)
      setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
      await fetchChallenge()
    } catch { toast.error('An error occurred') }
    finally { setScoreSubmitting(false) }
  }

  // ── Submit dispute score (non-reporter enters their version) ─────────────
  const handleSubmitDisputeScore = async () => {
    if (!challenge?.match_result) return
    const mr = challenge.match_result
    const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = disputeScore
    if (!s1ch || !s1cd || !s2ch || !s2cd) { toast.error('Enter scores for both sets'); return }

    const n = (v: string) => parseInt(v, 10)
    const set1ChWon = n(s1ch) > n(s1cd)
    const set2ChWon = n(s2ch) > n(s2cd)
    const chSets = (set1ChWon ? 1 : 0) + (set2ChWon ? 1 : 0)
    const cdSets = ((!set1ChWon) ? 1 : 0) + ((!set2ChWon) ? 1 : 0)
    const needsTB = chSets === 1 && cdSets === 1
    if (needsTB && (!tbch || !tbcd)) { toast.error('Sets are 1-1 — enter the super tiebreak scores'); return }

    const disputingTeamId = userTeamIds.find(id =>
      (id === challenge.challenging_team_id || id === challenge.challenged_team_id) &&
      id !== mr.reported_by_team_id
    )
    if (!disputingTeamId) { toast.error('Could not determine your team'); return }

    const winnerTeamId = chSets >= 2
      ? challenge.challenging_team_id
      : needsTB
        ? (n(tbch) > n(tbcd) ? challenge.challenging_team_id : challenge.challenged_team_id)
        : challenge.challenged_team_id

    setDisputeSubmitting(true)
    try {
      const res = await fetch(`/api/matches/${mr.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: disputingTeamId,
          set1Challenger: n(s1ch), set1Challenged: n(s1cd),
          set2Challenger: n(s2ch), set2Challenged: n(s2cd),
          supertiebreakChallenger: needsTB ? n(tbch) : null,
          supertiebreakChallenged: needsTB ? n(tbcd) : null,
          winnerTeamId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to file dispute'); return }
      toast.success('Dispute filed — the opposing team has been notified to review your score.')
      setDisputeModalOpen(false)
      setDisputeScore({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
      await fetchChallenge()
    } catch { toast.error('An error occurred') }
    finally { setDisputeSubmitting(false) }
  }

  // ── Accept disputed score (original reporter agrees with counter-score) ───
  const handleAcceptDisputedScore = async () => {
    if (!challenge?.match_result) return
    const mr = challenge.match_result
    const myTeamId = userTeamIds.find(id => id === mr.reported_by_team_id)
    if (!myTeamId) { toast.error('Only the original score reporter can accept the counter-score'); return }

    setAcceptDisputeLoading(true)
    try {
      const res = await fetch(`/api/matches/${mr.id}/dispute/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'accept', teamId: myTeamId }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to accept score'); return }
      toast.success('Score agreed — the ladder has been updated!')
      await fetchChallenge()
    } catch { toast.error('An error occurred') }
    finally { setAcceptDisputeLoading(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (!challenge) {
    return (
      <Card className="bg-slate-800/60 border-slate-700/50 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">Challenge Not Found</h3>
        <p className="text-slate-400 mb-4">This challenge does not exist or has been removed</p>
        <Button onClick={() => router.push('/challenges')}>Back to Challenges</Button>
      </Card>
    )
  }

  const isChallengingTeam = userTeamIds.includes(challenge.challenging_team_id)
  const isChallengedTeam = userTeamIds.includes(challenge.challenged_team_id)
  const slots = [challenge.slot_1, challenge.slot_2, challenge.slot_3].filter(Boolean) as string[]

  // Which team submitted the time (for time_pending_confirm logic)
  const isSubmittingTeam = !!(challenge.time_submitted_by_team_id &&
    userTeamIds.includes(challenge.time_submitted_by_team_id))
  const isConfirmingTeam = (isChallengingTeam || isChallengedTeam) && !isSubmittingTeam
  // Name of whichever team submitted the time (for UI labels)
  const submittingTeamName = challenge.time_submitted_by_team_id === challenge.challenging_team_id
    ? challenge.challenging_team?.name
    : challenge.challenged_team?.name

  // Accept deadline countdown (the 24-hour window)
  const acceptDeadline = challenge.accept_deadline ?? null

  const mr = challenge.match_result
  const resultVerified = !!(mr?.verified_at || mr?.auto_verified)

  const statusLabel: Record<string, string> = {
    pending: 'Awaiting response',
    accepted: isChallengingTeam ? 'Confirm the time' : 'Waiting for challenger to confirm',
    accepted_open: 'Enter agreed match time',
    time_pending_confirm: isSubmittingTeam
      ? 'Waiting for opponent to confirm the time'
      : (isChallengingTeam || isChallengedTeam) ? 'Please confirm the agreed time' : 'Awaiting time confirmation',
    reschedule_requested: challenge?.reschedule_requested_by && userTeamIds.includes(challenge.reschedule_requested_by)
      ? 'Awaiting other team\'s response'
      : 'Reschedule requested — please respond',
    reschedule_pending_admin: 'Awaiting admin approval',
    revision_proposed: 'Revised time proposed',
    scheduled: 'Match scheduled',
    result_pending: 'Awaiting result verification',
    played: 'Match completed',
    forfeited: 'Forfeited',
    dissolved: 'Dissolved',
  }

  const scheduledAt = challenge.confirmed_time ?? challenge.match_date ?? challenge.accepted_slot ?? null
  const venueObj = Array.isArray((challenge as any).venue) ? (challenge as any).venue[0] : (challenge as any).venue

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => router.back()}>← Back</Button>
        <div>
          <h1 className="text-2xl font-bold text-white">Challenge {challenge.challenge_code}</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {statusLabel[challenge.status] ?? challenge.status}
          </p>
        </div>
      </div>

      {/* Teams Card */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 text-center">
            <p className="font-semibold text-white text-lg">{challenge.challenging_team?.name}</p>
            <p className="text-slate-400 text-sm">
              {challenge.challenging_team?.player1?.name} &amp; {challenge.challenging_team?.player2?.name}
            </p>
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30 mt-1 inline-block">
              Challenger
            </span>
          </div>
          <ArrowRight className="h-6 w-6 text-emerald-500 flex-shrink-0" />
          <div className="flex-1 text-center">
            <p className="font-semibold text-white text-lg">{challenge.challenged_team?.name}</p>
            <p className="text-slate-400 text-sm">
              {challenge.challenged_team?.player1?.name} &amp; {challenge.challenged_team?.player2?.name}
            </p>
            <span className="text-[10px] bg-slate-500/20 text-slate-400 px-2 py-0.5 rounded-full border border-slate-500/30 mt-1 inline-block">
              Challenged
            </span>
          </div>
        </div>
      </Card>

      {/* Opponent Contact — WhatsApp numbers (visible only to involved teams) */}
      {(isChallengingTeam || isChallengedTeam) && !['dissolved'].includes(challenge.status) && (() => {
        const opponentTeam = isChallengingTeam ? challenge.challenged_team : challenge.challenging_team
        if (!opponentTeam) return null
        const players = [opponentTeam.player1, opponentTeam.player2].filter(Boolean) as PlayerContact[]
        const hasAnyPhone = players.some(p => p.phone)
        return (
          <Card className="bg-slate-800/60 border-slate-700/50 p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Contact Opponent — {opponentTeam.name}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {players.map((player, i) => {
                const raw = player.phone?.replace(/\D/g, '') ?? ''
                const waNumber = raw.startsWith('0') ? '92' + raw.slice(1) : raw
                const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi! I'm reaching out about our CPL challenge ${challenge.challenge_code} 🎾`)}`
                return (
                  <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-700/40 border border-slate-600/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{player.name}</p>
                      {player.phone ? (
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                          <Phone className="h-3 w-3 flex-shrink-0" />
                          {player.phone}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-0.5">No phone on file</p>
                      )}
                    </div>
                    {player.phone && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-xs font-medium"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
            {!hasAnyPhone && (
              <p className="text-xs text-slate-500 mt-3 text-center">Neither player has a phone number on their profile yet.</p>
            )}
          </Card>
        )
      })()}

      {/* In-App Chat — show once the chat room exists */}
      {chatId && (isChallengingTeam || isChallengedTeam) && (
        <Card className="bg-slate-800/60 border-slate-700/50 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-emerald-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Match Chat</h3>
                <p className="text-xs text-slate-400 mt-0.5">Coordinate with your opponents in-app</p>
              </div>
            </div>
            <Link
              href={`/chat/${chatId}`}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors text-sm font-medium"
            >
              <MessageCircle className="h-4 w-4" />
              Open Chat
            </Link>
          </div>
        </Card>
      )}

      {/* Proposed slots — collapsible reference for challenger */}
      {isChallengingTeam && slots.length > 0 && ['pending', 'accepted_open'].includes(challenge.status) && (
        <Card className="bg-slate-800/60 border-slate-700/50 overflow-hidden">
          <button
            onClick={() => setSlotsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Your Proposed Slots</p>
            </div>
            {slotsOpen
              ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
              : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          </button>
          {slotsOpen && (
            <div className="px-4 pb-3 flex flex-col gap-1.5 border-t border-slate-700/40 pt-2.5">
              {slots.map((slot, i) => (
                <div key={slot} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="text-[10px] font-bold text-slate-500 w-10 shrink-0">Slot {i + 1}</span>
                  <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  {new Date(slot).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Status + Countdown Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {/* Status */}
        <Card className="bg-slate-800/60 border-slate-700/50 p-4 flex items-center gap-3">
          {challenge.status === 'pending' && <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />}
          {['accepted', 'accepted_open', 'time_pending_confirm'].includes(challenge.status) && <Clock className="h-5 w-5 text-orange-400 flex-shrink-0" />}
          {['reschedule_requested', 'reschedule_pending_admin', 'revision_proposed'].includes(challenge.status) && <RefreshCw className="h-5 w-5 text-purple-400 flex-shrink-0" />}
          {challenge.status === 'scheduled' && <Calendar className="h-5 w-5 text-blue-500 flex-shrink-0" />}
          {challenge.status === 'played' && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />}
          {(challenge.status === 'forfeited' || challenge.status === 'dissolved') && (
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          )}
          <div>
            <p className="text-[10px] text-slate-400">Status</p>
            <p className="font-semibold text-white text-sm capitalize">{challenge.status.replace('_', ' ')}</p>
          </div>
        </Card>

        {/* Accept deadline countdown — when pending */}
        {challenge.status === 'pending' && acceptDeadline && (
          <Card className="bg-slate-800/60 border-slate-700/50 p-4 col-span-2 sm:col-span-1">
            <CountdownDisplay deadline={acceptDeadline} label="Accept deadline" />
          </Card>
        )}
        {/* Confirmation window countdown — show to whichever team must confirm */}
        {challenge.status === 'accepted' && challenge.confirmation_deadline && isChallengingTeam && (
          <Card className="bg-orange-500/10 border-orange-500/30 p-4 col-span-2 sm:col-span-1">
            <CountdownDisplay deadline={challenge.confirmation_deadline} label="Auto-confirms in" />
          </Card>
        )}
        {challenge.status === 'time_pending_confirm' && challenge.confirmation_deadline && isConfirmingTeam && (
          <Card className="bg-orange-500/10 border-orange-500/30 p-4 col-span-2 sm:col-span-1">
            <CountdownDisplay deadline={challenge.confirmation_deadline} label="Auto-confirms in" />
          </Card>
        )}

        {/* Challenge code */}
        <Card className="bg-slate-800/60 border-slate-700/50 p-4 flex items-center gap-3">
          <Trophy className="h-5 w-5 text-slate-400 flex-shrink-0" />
          <div>
            <p className="text-[10px] text-slate-400">Challenge Code</p>
            <code className="font-semibold text-white text-sm">{challenge.challenge_code}</code>
          </div>
        </Card>
      </div>

      {/* ── PENDING: Challenged team — choose acceptance option ── */}
      {challenge.status === 'pending' && isChallengedTeam && (
        <Card className="bg-slate-800/60 border-slate-700/50 p-6 space-y-5">
          <div>
            <h3 className="font-semibold text-white text-lg mb-1">Respond to Challenge</h3>
            <p className="text-slate-400 text-sm">Coordinate with the other team and agree on a date and time that works for both sides.</p>
          </div>

          {/* Option picker */}
          {!acceptOption && (
            <div className="space-y-3">
              <button
                onClick={() => setAcceptOption('slot')}
                className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-600/50 bg-slate-700/30 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">Pick one of their suggested slots</p>
                  <p className="text-xs text-slate-400 mt-0.5">Choose from the 3 times they offered. You cannot change to a different time after this.</p>
                </div>
              </button>

              <button
                onClick={() => setAcceptOption('open')}
                className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-600/50 bg-slate-700/30 hover:border-blue-500/50 hover:bg-blue-500/5 text-left transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">Accept — agree on a time over WhatsApp</p>
                  <p className="text-xs text-slate-400 mt-0.5">Accept now and enter the mutually agreed time later. You won't be able to choose from their slots.</p>
                </div>
              </button>

              <Button
                onClick={() => setShowDeclineConfirm(true)}
                variant="outline"
                className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 h-10 text-sm"
              >
                <X className="h-4 w-4 mr-2" />Decline (counts as forfeit)
              </Button>
            </div>
          )}

          {/* Option 2: Pick a slot */}
          {acceptOption === 'slot' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Select one of their suggested slots</p>
                <button onClick={() => { setAcceptOption(null); setSelectedSlotIndex(null) }} className="text-xs text-slate-500 hover:text-slate-300">← Back</button>
              </div>
              {slots.length === 0 ? (
                <p className="text-slate-500 text-sm">No slots were provided.</p>
              ) : slots.map((slot, i) => {
                const d = new Date(slot)
                const isSelected = selectedSlotIndex === i
                return (
                  <button key={slot} onClick={() => setSelectedSlotIndex(i)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${isSelected ? 'bg-emerald-500/15 border-emerald-500/60 ring-1 ring-emerald-500/40' : 'bg-slate-700/30 border-slate-600/40 hover:border-slate-500/60'}`}>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? 'border-emerald-500' : 'border-slate-500'}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                    </div>
                    <Calendar className={`h-4 w-4 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <div>
                      <p className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                      <p className={`text-xs ${isSelected ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        <span className="ml-2 text-slate-600">Slot {i + 1}</span>
                      </p>
                    </div>
                  </button>
                )
              })}
              <p className="text-xs text-slate-500">Venue will be confirmed after discussing over WhatsApp.</p>
              <Button onClick={handleAccept} disabled={actionLoading || selectedSlotIndex === null} className="w-full bg-emerald-500 hover:bg-emerald-600 h-11">
                {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Confirm Selected Slot
              </Button>
            </div>
          )}

          {/* Option 1: Accept open */}
          {acceptOption === 'open' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-300">Accepting without a slot — you'll enter the agreed time later.</p>
                <button onClick={() => setAcceptOption(null)} className="text-xs text-slate-500 hover:text-slate-300 shrink-0 ml-2">← Back</button>
              </div>
              <Button onClick={handleAccept} disabled={actionLoading} className="w-full bg-blue-500 hover:bg-blue-600 h-11">
                {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Accept — I'll enter the time later
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* ── ACCEPTED_OPEN: Either team enters the agreed time ── */}
      {challenge.status === 'accepted_open' && (isChallengedTeam || isChallengingTeam) && (
        <Card className="bg-slate-800/60 border-amber-500/30 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-amber-400" />
            <h3 className="font-semibold text-white">Enter Agreed Match Time</h3>
          </div>
          <p className="text-slate-400 text-sm">
            Coordinate a time and venue with{' '}
            <span className="text-white font-medium">
              {isChallengingTeam ? challenge.challenged_team?.name : challenge.challenging_team?.name}
            </span>{' '}
            over WhatsApp. Either team can enter the agreed details below — the other team will confirm in the app.
          </p>
          {challenge.match_deadline && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">
                Match must be played by{' '}
                <span className="font-semibold">
                  {new Date(challenge.match_deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </p>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">
              Agreed date &amp; time <span className="text-red-400">*</span>
            </label>
            <DateTimeSlotPicker value={setTimeInput} onChange={setSetTimeInput} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-1.5">
              Venue <span className="text-red-400">*</span>
            </label>
            <VenuePicker venueList={venues} value={setTimeVenueId} onChange={setSetTimeVenueId} />
          </div>
          <Button
            onClick={handleSetTime}
            disabled={actionLoading || !setTimeInput || !setTimeVenueId}
            className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Submit Time for Confirmation
          </Button>
        </Card>
      )}

      {/* ── PENDING: Waiting message for challenging team ── */}
      {challenge.status === 'pending' && isChallengingTeam && (
        <Card className="bg-blue-500/10 border-blue-500/30 p-6">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-300 mb-1">Waiting for Response</p>
              <p className="text-blue-200 text-sm">
                {challenge.challenged_team?.name} will coordinate a time with you over WhatsApp, then enter it in the app for you to confirm.
                They have until the deadline to accept.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── ACCEPTED: Challenging team — confirm or dispute ── */}
      {challenge.status === 'accepted' && isChallengingTeam && (
        <Card className="bg-slate-800/60 border-orange-500/30 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-400" />
            <h3 className="font-semibold text-white">Confirm Match Time</h3>
          </div>
          <p className="text-slate-400 text-sm">
            {challenge.challenged_team?.name} has entered the agreed match details. Please confirm they match what you agreed, or dispute if the time is different from what you arranged.
          </p>

          {/* Confirmed time + venue */}
          <div className="p-4 bg-slate-700/40 border border-slate-600 rounded-lg space-y-3">
            {(challenge.accepted_slot || challenge.confirmed_time) && (
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400">
                    Date &amp; Time
                    {challenge.accepted_slot && !challenge.confirmed_time && (
                      <span className="ml-1.5 text-slate-500">(from your suggested slot)</span>
                    )}
                  </p>
                  <p className="font-semibold text-white">
                    {new Date((challenge.accepted_slot ?? challenge.confirmed_time)!).toLocaleDateString('en-GB', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    })}{' '}
                    at{' '}
                    {new Date((challenge.accepted_slot ?? challenge.confirmed_time)!).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                </div>
              </div>
            )}
            {venueObj && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400">Venue</p>
                  <p className="font-semibold text-white">{venueObj.name}</p>
                  {venueObj.address && <p className="text-slate-400 text-xs">{venueObj.address}</p>}
                  {venueObj.notes && <p className="text-emerald-400/70 text-xs mt-0.5">{venueObj.notes}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-xs text-orange-300">
            If you don't respond before the countdown expires, the match will be automatically confirmed.
          </div>

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => handleConfirmChallenge('confirm')}
              disabled={actionLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 h-11"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Confirm — This matches what we agreed
            </Button>
            <Button
              onClick={() => handleConfirmChallenge('dispute')}
              disabled={actionLoading}
              variant="outline"
              className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 h-11"
            >
              <X className="h-4 w-4 mr-2" />
              Dispute — This isn't what we agreed
            </Button>
          </div>
        </Card>
      )}

      {/* ── ACCEPTED: Waiting message for challenged team ── */}
      {challenge.status === 'accepted' && isChallengedTeam && (
        <Card className="bg-orange-500/10 border-orange-500/30 p-6">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-orange-300 mb-1">Waiting for Confirmation</p>
              <p className="text-orange-200/80 text-sm">
                {challenge.challenging_team?.name} needs to confirm the match time. It auto-confirms if they don't respond before the deadline.
              </p>
              {(challenge.accepted_slot || challenge.confirmed_time) && (
                <p className="text-orange-200 text-sm mt-2 font-medium">
                  Time set:{' '}
                  {new Date((challenge.accepted_slot ?? challenge.confirmed_time)!).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}{' '}
                  at{' '}
                  {new Date((challenge.accepted_slot ?? challenge.confirmed_time)!).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── TIME_PENDING_CONFIRM: Confirming team — confirm or dispute entered time ── */}
      {challenge.status === 'time_pending_confirm' && isConfirmingTeam && (
        <Card className="bg-slate-800/60 border-orange-500/30 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-400" />
            <h3 className="font-semibold text-white">Confirm Agreed Match Time</h3>
          </div>
          <p className="text-slate-400 text-sm">
            <span className="text-white font-medium">{submittingTeamName}</span> has entered the agreed match time. Please confirm it matches what you arranged, or dispute it if something is different.
          </p>

          <div className="p-4 bg-slate-700/40 border border-slate-600 rounded-lg space-y-3">
            {challenge.confirmed_time && (
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400">Date &amp; Time entered by opponent</p>
                  <p className="font-semibold text-white">
                    {new Date(challenge.confirmed_time).toLocaleDateString('en-GB', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    })}{' '}
                    at{' '}
                    {new Date(challenge.confirmed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                </div>
              </div>
            )}
            {venueObj && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400">Venue</p>
                  <p className="font-semibold text-white">{venueObj.name}</p>
                  {venueObj.address && <p className="text-slate-400 text-xs">{venueObj.address}</p>}
                </div>
              </div>
            )}
          </div>

          {challenge.confirmation_deadline && (
            <Card className="bg-orange-500/10 border-orange-500/20 p-3">
              <CountdownDisplay deadline={challenge.confirmation_deadline} label="Auto-confirms in" />
              <p className="text-center text-xs text-slate-400 mt-2">
                If you don't respond in time, the match will be automatically confirmed.
              </p>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => handleConfirmChallenge('confirm')}
              disabled={actionLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 h-11"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Confirm — This matches what we agreed
            </Button>
            <Button
              onClick={() => handleConfirmChallenge('dispute')}
              disabled={actionLoading}
              variant="outline"
              className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 h-11"
            >
              <X className="h-4 w-4 mr-2" />
              Dispute — This isn't what we agreed
            </Button>
          </div>
        </Card>
      )}

      {/* ── TIME_PENDING_CONFIRM: Waiting message for the team that submitted ── */}
      {challenge.status === 'time_pending_confirm' && isSubmittingTeam && (
        <Card className="bg-orange-500/10 border-orange-500/30 p-6">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-orange-300 mb-1">Waiting for Confirmation</p>
              <p className="text-orange-200/80 text-sm">
                You entered the time — the other team needs to confirm it. It auto-confirms if they don't respond before the deadline.
              </p>
              {challenge.confirmed_time && (
                <p className="text-orange-200 text-sm mt-2 font-medium">
                  Time submitted:{' '}
                  {new Date(challenge.confirmed_time).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}{' '}
                  at{' '}
                  {new Date(challenge.confirmed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── ADD VENUE: shows on accepted or scheduled when no venue set ── */}
      {['accepted', 'scheduled'].includes(challenge.status) && !venueObj && !challenge.match_location && (isChallengingTeam || isChallengedTeam) && (
        <Card className="bg-slate-800/60 border-slate-700/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-300">Match Venue</span>
              <span className="text-xs text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-full">Not set yet</span>
            </div>
            {!showAddVenue && (
              <button
                onClick={() => setShowAddVenue(true)}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                + Add venue
              </button>
            )}
          </div>

          {showAddVenue && (
            <div className="space-y-3">
              {addVenuesList.length === 0 ? (
                <p className="text-slate-500 text-sm">No venues configured — ask an admin to add venues.</p>
              ) : (
                <VenuePicker venueList={addVenuesList} value={addVenueId} onChange={setAddVenueId} />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddVenue}
                  disabled={!addVenueId || addVenueLoading}
                  className="bg-emerald-500 hover:bg-emerald-600 h-9 text-sm"
                >
                  {addVenueLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                  Save Venue
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowAddVenue(false); setAddVenueId('') }}
                  className="h-9 text-sm text-slate-400"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── SCHEDULED: Match details ── */}
      {challenge.status === 'scheduled' && (
        <Card className="bg-slate-800/60 border-emerald-500/30 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            <h3 className="font-semibold text-white">Match Scheduled</h3>
          </div>
          {scheduledAt && (
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Date &amp; Time</p>
                <p className="font-semibold text-white">
                  {new Date(scheduledAt).toLocaleDateString('en-GB', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}{' '}
                  at{' '}
                  {new Date(scheduledAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </p>
              </div>
            </div>
          )}
          {(venueObj || challenge.match_location) && (
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Venue</p>
                <p className="font-semibold text-white">{venueObj ? venueObj.name : challenge.match_location}</p>
                {venueObj?.address && <p className="text-slate-400 text-xs">{venueObj.address}</p>}
                {venueObj?.notes && <p className="text-emerald-400/70 text-xs">{venueObj.notes}</p>}
              </div>
            </div>
          )}
          {/* Either team can enter the score once the match has been played */}
          {(isChallengingTeam || isChallengedTeam) && !challenge.match_result && (
            <Button
              onClick={() => { setScoreModalOpen(true); setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }) }}
              className="w-full bg-emerald-500 hover:bg-emerald-600 h-12 font-semibold"
            >
              <Flag className="h-4 w-4 mr-2" /> Enter Match Score
            </Button>
          )}
        </Card>
      )}

      {/* ── SCHEDULED: Request Reschedule button + inline form ── */}
      {challenge.status === 'scheduled' && (isChallengingTeam || isChallengedTeam) && (
        <Card className="bg-slate-800/60 border-slate-700/50 p-5">
          {!showRescheduleForm ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-300">Need to change the time or venue?</span>
              </div>
              <button
                onClick={() => setShowRescheduleForm(true)}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                Request reschedule
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-emerald-400" />
                  <h3 className="font-semibold text-white text-sm">Request a Reschedule</h3>
                </div>
                <button
                  onClick={() => { setShowRescheduleForm(false); setRescheduleTime(''); setRescheduleVenueId(''); setRescheduleReason('') }}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
              <p className="text-slate-400 text-xs">
                The other team will need to confirm the new time before an admin approves it. All times must be within the match deadline.
              </p>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">
                  New date &amp; time <span className="text-red-400">*</span>
                </label>
                <DateTimeSlotPicker value={rescheduleTime} onChange={setRescheduleTime} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">
                  New venue <span className="text-slate-500 font-normal">(optional — leave blank to keep current)</span>
                </label>
                <VenuePicker
                  venueList={venues}
                  value={rescheduleVenueId}
                  onChange={setRescheduleVenueId}
                  allowEmpty
                  emptyLabel="Keep current venue"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">
                  Reason <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={rescheduleReason}
                  onChange={e => setRescheduleReason(e.target.value)}
                  placeholder="e.g. clash with another commitment"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 h-11 placeholder-slate-500"
                />
              </div>
              <Button
                onClick={handleRescheduleRequest}
                disabled={actionLoading || !rescheduleTime}
                className="w-full bg-emerald-500 hover:bg-emerald-600 h-11"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Send Reschedule Request
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* ── RESCHEDULE_REQUESTED: Other team responds ── */}
      {challenge.status === 'reschedule_requested' && (() => {
        const isRequester = !!(challenge.reschedule_requested_by && userTeamIds.includes(challenge.reschedule_requested_by))
        const requestingTeamName = challenge.reschedule_requested_by === challenge.challenging_team_id
          ? challenge.challenging_team?.name
          : challenge.challenged_team?.name

        if (isRequester) {
          return (
            <Card className="bg-blue-500/10 border-blue-500/30 p-6">
              <div className="flex items-start gap-3">
                <RefreshCw className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-semibold text-blue-300">Reschedule Request Sent</p>
                  <p className="text-blue-200/80 text-sm">
                    Waiting for the other team to confirm or decline your proposed new time.
                  </p>
                  {challenge.reschedule_proposed_time && (
                    <div className="mt-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <p className="text-xs text-slate-400 mb-1">Your proposed time</p>
                      <p className="text-white font-medium text-sm">
                        {new Date(challenge.reschedule_proposed_time).toLocaleDateString('en-GB', {
                          weekday: 'short', day: 'numeric', month: 'short',
                        })}{' '}
                        at{' '}
                        {new Date(challenge.reschedule_proposed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                      {challenge.reschedule_reason && (
                        <p className="text-slate-400 text-xs mt-1">Reason: {challenge.reschedule_reason}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        }

        return (
          <Card className="bg-slate-800/60 border-purple-500/30 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-purple-400" />
              <h3 className="font-semibold text-white">Reschedule Requested</h3>
            </div>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-medium">{requestingTeamName}</span> wants to reschedule the match. Please review and confirm or decline.
            </p>

            <div className="p-4 bg-slate-700/40 border border-slate-600 rounded-lg space-y-3">
              {challenge.reschedule_proposed_time && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">Proposed new time</p>
                    <p className="font-semibold text-white">
                      {new Date(challenge.reschedule_proposed_time).toLocaleDateString('en-GB', {
                        weekday: 'long', day: 'numeric', month: 'long',
                      })}{' '}
                      at{' '}
                      {new Date(challenge.reschedule_proposed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                </div>
              )}
              {challenge.reschedule_reason && (
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">Reason given</p>
                    <p className="text-slate-300 text-sm">{challenge.reschedule_reason}</p>
                  </div>
                </div>
              )}
              {scheduledAt && (
                <div className="flex items-start gap-3">
                  <Clock className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-500">Current scheduled time (if you decline)</p>
                    <p className="text-slate-400 text-sm">
                      {new Date(scheduledAt).toLocaleDateString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short',
                      })}{' '}
                      at{' '}
                      {new Date(scheduledAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500">
              If you confirm, an admin will review and approve the new time before it's finalised.
            </p>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => handleRescheduleRespond('confirm')}
                disabled={actionLoading}
                className="w-full bg-purple-500 hover:bg-purple-600 h-11"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Agree to Reschedule
              </Button>
              <Button
                onClick={() => handleRescheduleRespond('decline')}
                disabled={actionLoading}
                variant="outline"
                className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 h-11"
              >
                <X className="h-4 w-4 mr-2" />
                Decline — Keep Original Time
              </Button>
            </div>
          </Card>
        )
      })()}

      {/* ── RESCHEDULE_PENDING_ADMIN: Both teams waiting for admin ── */}
      {challenge.status === 'reschedule_pending_admin' && (
        <Card className="bg-yellow-500/10 border-yellow-500/30 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-semibold text-yellow-300">Awaiting Admin Approval</p>
              <p className="text-yellow-200/80 text-sm">
                Both teams have agreed to the reschedule. An admin will review and either approve or reject the new time.
              </p>
              {challenge.reschedule_proposed_time && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Proposed new time</p>
                  <p className="text-white font-medium text-sm">
                    {new Date(challenge.reschedule_proposed_time).toLocaleDateString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}{' '}
                    at{' '}
                    {new Date(challenge.reschedule_proposed_time).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Forfeit option — visible throughout the active lifecycle ── */}
      {(isChallengingTeam || isChallengedTeam) &&
        !['forfeited', 'dissolved'].includes(challenge.status) &&
        !(challenge.status === 'played' && resultVerified) && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowForfeitConfirm(true)}
            className="text-xs text-red-400/50 hover:text-red-400 transition-colors py-1 px-3 rounded"
          >
            Forfeit this challenge
          </button>
        </div>
      )}

      {/* ── FORFEITED / DISSOLVED ── */}
      {['forfeited', 'dissolved'].includes(challenge.status) && (
        <Card className={`p-6 ${
          challenge.status === 'dissolved'
            ? 'bg-slate-800/50 border-slate-600/50'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex items-start gap-3">
            <XCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
              challenge.status === 'dissolved' ? 'text-slate-400' : 'text-red-400'
            }`} />
            <div className="space-y-1">
              <p className={`font-semibold capitalize ${
                challenge.status === 'dissolved' ? 'text-slate-300' : 'text-red-300'
              }`}>
                {challenge.status === 'forfeited' ? 'Challenge Forfeited' : 'Challenge Dissolved'}
              </p>
              {challenge.status === 'dissolved' && (challenge as any).dissolved_reason ? (
                <p className="text-slate-400 text-sm">
                  {(challenge as any).dissolved_reason}
                </p>
              ) : (
                <p className={`text-sm mt-1 ${
                  challenge.status === 'dissolved' ? 'text-slate-500' : 'text-red-300/70'
                }`}>
                  {challenge.status === 'forfeited'
                    ? 'This challenge ended in a forfeit.'
                    : 'This challenge was dissolved.'}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Match Result + Verify / Dispute ── */}
      {challenge.match_result && (() => {
        const mr = challenge.match_result
        const isReporter = userTeamIds.includes(mr.reported_by_team_id)
        const isInvolved = isChallengingTeam || isChallengedTeam

        const isVerified = !!(mr.verified_at || mr.auto_verified || mr.dispute_resolved_at)
        const hasActiveDispute = !!(mr.disputed_at && !mr.dispute_resolved_at)
        const isFlaggedForAdmin = !!(mr.dispute_flagged_at && !mr.dispute_resolved_at)

        // Who can verify: must be involved, non-reporter, not yet disputed or verified
        const canVerify = isInvolved && !mr.verified_at && !mr.auto_verified && !mr.disputed_at && !isReporter && challenge.status === 'result_pending'
        // Who can dispute: must be involved, non-reporter, not yet disputed, not yet verified
        const canDispute = isInvolved && !mr.verified_at && !mr.auto_verified && !mr.disputed_at && !isReporter && challenge.status === 'result_pending'
        // Reporter can accept disputed score
        const canAcceptDispute = hasActiveDispute && isReporter && !isFlaggedForAdmin

        const scoreRowBg = (disputed: boolean) =>
          disputed ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-slate-700/30'

        const ScoreDisplay = ({ scores, label, variant }: {
          scores: { set1_challenger: number | undefined; set1_challenged: number | undefined; set2_challenger: number | undefined; set2_challenged: number | undefined; supertiebreak_challenger?: number | null; supertiebreak_challenged?: number | null; winner_team_id?: string }
          label: string
          variant: 'original' | 'disputed' | 'final'
        }) => {
          const colourMap = { original: 'text-slate-300', disputed: 'text-orange-300', final: 'text-emerald-300' } as const
          const bgMap = { original: 'bg-slate-700/30', disputed: 'bg-orange-500/10 border border-orange-500/20', final: 'bg-emerald-500/10 border border-emerald-500/20' } as const
          const winnerTeamName = scores.winner_team_id === challenge.challenging_team_id
            ? challenge.challenging_team?.name
            : scores.winner_team_id === challenge.challenged_team_id
              ? challenge.challenged_team?.name
              : null

          return (
            <div className={`rounded-xl p-4 space-y-3 ${bgMap[variant]}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${colourMap[variant]}`}>{label}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { lbl: 'Set 1', ch: scores.set1_challenger, cd: scores.set1_challenged },
                  { lbl: 'Set 2', ch: scores.set2_challenger, cd: scores.set2_challenged },
                  ...(scores.supertiebreak_challenger != null
                    ? [{ lbl: 'Super TB', ch: scores.supertiebreak_challenger ?? undefined, cd: scores.supertiebreak_challenged ?? undefined }]
                    : []),
                ].map(({ lbl, ch, cd }) => (
                  <div key={lbl} className="p-2 bg-black/20 rounded-lg">
                    <p className="text-[10px] text-slate-400 mb-1">{lbl}</p>
                    <p className="text-lg font-bold text-white">{ch ?? '—'}–{cd ?? '—'}</p>
                    <p className="text-[9px] text-slate-500">Ch–Cd</p>
                  </div>
                ))}
              </div>
              {winnerTeamName && (
                <div className="flex items-center gap-2">
                  <Trophy className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-400 font-semibold">{winnerTeamName} wins</p>
                </div>
              )}
            </div>
          )
        }

        return (
          <Card className={`border p-6 space-y-4 ${
            isVerified ? 'bg-emerald-500/5 border-emerald-500/30'
            : isFlaggedForAdmin ? 'bg-red-500/5 border-red-500/30'
            : hasActiveDispute ? 'bg-orange-500/5 border-orange-500/30'
            : 'bg-slate-800/60 border-slate-700/50'
          }`}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Match Result</h3>
              {isVerified && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-full">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {mr.dispute_resolved_at ? 'Dispute Resolved' : mr.auto_verified ? 'Auto-verified' : 'Verified'}
                </span>
              )}
              {isFlaggedForAdmin && (
                <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-full">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Under Admin Review
                </span>
              )}
              {hasActiveDispute && !isFlaggedForAdmin && (
                <span className="flex items-center gap-1.5 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-1 rounded-full">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Score Disputed
                </span>
              )}
              {!isVerified && !hasActiveDispute && challenge.status === 'played' && (
                <span className="flex items-center gap-1.5 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-2 py-1 rounded-full">
                  <Clock className="h-3.5 w-3.5" />
                  Pending verification
                </span>
              )}
            </div>

            {/* ── Score content: only visible to participants until verified ── */}
            {(isVerified || isInvolved) ? (
              <>
                {/* No active dispute: show submitted score */}
                {!hasActiveDispute && (
                  <ScoreDisplay
                    scores={{
                      set1_challenger: mr.set1_challenger,
                      set1_challenged: mr.set1_challenged,
                      set2_challenger: mr.set2_challenger,
                      set2_challenged: mr.set2_challenged,
                      supertiebreak_challenger: mr.supertiebreak_challenger,
                      supertiebreak_challenged: mr.supertiebreak_challenged,
                      winner_team_id: mr.winner_team_id,
                    }}
                    label={isVerified ? 'Final Score' : `Reported by ${mr.reported_by_team_id === challenge.challenging_team_id ? challenge.challenging_team?.name : challenge.challenged_team?.name}`}
                    variant={isVerified ? 'final' : 'original'}
                  />
                )}

                {/* Active dispute: show both versions side by side */}
                {hasActiveDispute && mr.disputed_score && (
                  <div className="space-y-3">
                    <ScoreDisplay
                      scores={{
                        set1_challenger: mr.set1_challenger,
                        set1_challenged: mr.set1_challenged,
                        set2_challenger: mr.set2_challenger,
                        set2_challenged: mr.set2_challenged,
                        supertiebreak_challenger: mr.supertiebreak_challenger,
                        supertiebreak_challenged: mr.supertiebreak_challenged,
                        winner_team_id: mr.winner_team_id,
                      }}
                      label={`Originally reported by ${mr.reported_by_team_id === challenge.challenging_team_id ? challenge.challenging_team?.name : challenge.challenged_team?.name}`}
                      variant="original"
                    />
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-orange-500/30" />
                      <span className="text-xs text-orange-400 font-semibold">DISPUTED — COUNTER-SCORE</span>
                      <div className="h-px flex-1 bg-orange-500/30" />
                    </div>
                    <ScoreDisplay
                      scores={{
                        set1_challenger: mr.disputed_score.set1_challenger,
                        set1_challenged: mr.disputed_score.set1_challenged,
                        set2_challenger: mr.disputed_score.set2_challenger,
                        set2_challenged: mr.disputed_score.set2_challenged,
                        supertiebreak_challenger: mr.disputed_score.supertiebreak_challenger,
                        supertiebreak_challenged: mr.disputed_score.supertiebreak_challenged,
                        winner_team_id: mr.disputed_score.winner_team_id,
                      }}
                      label={`Counter-score by ${mr.reported_by_team_id === challenge.challenging_team_id ? challenge.challenged_team?.name : challenge.challenging_team?.name}`}
                      variant="disputed"
                    />
                  </div>
                )}
              </>
            ) : (
              /* Third-party view: score hidden until verified */
              <div className="flex items-center gap-3 p-4 bg-slate-100 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600/40 rounded-xl">
                <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Score is hidden until both teams have verified the result.
                </p>
              </div>
            )}

            {/* ── Flagged for admin review ── */}
            {isFlaggedForAdmin && (
              <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-300 text-sm">Escalated to Admin</p>
                  <p className="text-red-200/70 text-xs mt-0.5">
                    The resolution window expired without agreement. An admin will review both scores and set the final result.
                  </p>
                </div>
              </div>
            )}

            {/* ── Verify countdown (non-reporter, no dispute, not yet verified) ── */}
            {canVerify && mr.verify_deadline && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <CountdownDisplay deadline={mr.verify_deadline} label="Time to verify" />
                <p className="text-center text-xs text-slate-400 mt-2">
                  If you don't respond in time, the result will be auto-approved.
                </p>
              </div>
            )}

            {/* ── Verify + Dispute buttons (non-reporter, no dispute filed yet) ── */}
            {canVerify && isInvolved && (
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => handleVerify('verify')}
                  disabled={actionLoading}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Verify Result
                </Button>
                <Button
                  onClick={() => { setDisputeModalOpen(true); setDisputeScore({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }) }}
                  disabled={actionLoading}
                  variant="outline"
                  className="flex-1 border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Dispute Score
                </Button>
              </div>
            )}

            {/* ── Reporter: accept disputed counter-score ── */}
            {canAcceptDispute && isInvolved && (
              <div className="space-y-3 pt-1">
                <p className="text-sm text-orange-200/80">
                  If their counter-score is correct, you can accept it below and the ladder will be updated accordingly.
                </p>
                <Button
                  onClick={handleAcceptDisputedScore}
                  disabled={acceptDisputeLoading}
                  className="w-full bg-orange-500 hover:bg-orange-600 h-11"
                >
                  {acceptDisputeLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Accept Their Score
                </Button>
              </div>
            )}

            {/* ── Disputer waiting message (dispute filed, not flagged yet) ── */}
            {hasActiveDispute && !isReporter && !isFlaggedForAdmin && isInvolved && (
              <div className="flex items-center gap-2 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <Clock className="h-4 w-4 text-orange-400 flex-shrink-0" />
                <p className="text-orange-300 text-sm">
                  Waiting for the opposing team to accept your counter-score. If they don't respond in time, an admin will be notified.
                </p>
              </div>
            )}

            {/* ── Reporter waiting (no dispute) ── */}
            {!isVerified && !hasActiveDispute && isReporter && challenge.status === 'played' && (
              <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Clock className="h-4 w-4 text-blue-400 flex-shrink-0" />
                <p className="text-blue-300 text-sm">
                  Waiting for the opposing team to verify. Result auto-approves when the timer expires.
                </p>
              </div>
            )}
          </Card>
        )
      })()}

      {/* ── Inline Score Entry Modal ── */}
      {scoreModalOpen && challenge && (() => {
        const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = scoreState
        const n = (v: string) => parseInt(v, 10) || 0
        const set1ChWon = s1ch && s1cd ? n(s1ch) > n(s1cd) : null
        const set2ChWon = s2ch && s2cd ? n(s2ch) > n(s2cd) : null
        const chSets = (set1ChWon ? 1 : 0) + (set2ChWon ? 1 : 0)
        const cdSets = ((set1ChWon === false) ? 1 : 0) + ((set2ChWon === false) ? 1 : 0)
        const needsTB = s1ch && s1cd && s2ch && s2cd && chSets === 1 && cdSets === 1
        const winner = chSets >= 2 ? challenge.challenging_team?.name
          : cdSets >= 2 ? challenge.challenged_team?.name
          : needsTB && tbch && tbcd ? (n(tbch) > n(tbcd) ? challenge.challenging_team?.name : challenge.challenged_team?.name)
          : null

        const setScore = (field: keyof typeof scoreState) => (e: React.ChangeEvent<HTMLInputElement>) =>
          setScoreState(prev => ({ ...prev, [field]: e.target.value }))

        const ScoreRow = ({ label, chField, cdField }: { label: string; chField: keyof typeof scoreState; cdField: keyof typeof scoreState }) => (
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs font-semibold w-8 shrink-0 text-center">{label}</span>
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{challenge.challenging_team?.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={scoreState[chField]} onChange={setScore(chField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
              <span className="text-slate-500 font-bold text-xl mt-6 shrink-0">–</span>
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{challenge.challenged_team?.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={scoreState[cdField]} onChange={setScore(cdField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
            </div>
          </div>
        )

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
            onClick={e => { if (e.target === e.currentTarget) setScoreModalOpen(false) }}>
            <div className="w-full sm:max-w-sm bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-center sm:hidden">
                <div className="w-10 h-1 bg-slate-600 rounded-full" />
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Flag className="h-4 w-4 text-emerald-400" />
                    <h3 className="font-bold text-white text-lg">Enter Match Score</h3>
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {challenge.challenging_team?.name} vs {challenge.challenged_team?.name}
                  </p>
                </div>
                <button onClick={() => setScoreModalOpen(false)} className="text-slate-400 hover:text-white p-2 -mr-1 rounded-lg" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <ScoreRow label="Set 1" chField="s1ch" cdField="s1cd" />
                <ScoreRow label="Set 2" chField="s2ch" cdField="s2cd" />
                {needsTB && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-slate-600" />
                      <span className="text-xs text-orange-400 font-semibold tracking-wide">SUPER TIEBREAK</span>
                      <div className="h-px flex-1 bg-slate-600" />
                    </div>
                    <ScoreRow label="TB" chField="tbch" cdField="tbcd" />
                  </div>
                )}
              </div>
              {winner ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <Trophy className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">Winner</p>
                    <p className="font-bold text-emerald-400">{winner}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-700/30 border border-slate-600/40 rounded-xl text-center">
                  <p className="text-slate-500 text-xs">Enter scores above to see winner</p>
                </div>
              )}
              <div className="flex gap-3 pb-1">
                <Button onClick={handleSubmitScore} disabled={scoreSubmitting || !winner}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 h-12 text-base font-semibold">
                  {scoreSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle className="h-5 w-5 mr-2" />}
                  Submit Score
                </Button>
                <Button onClick={() => setScoreModalOpen(false)} variant="outline" className="h-12 px-5 border-slate-600 text-slate-300">
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-slate-500 text-center pb-1">The opposing team will be asked to verify this result.</p>
            </div>
          </div>
        )
      })()}

      {/* ── Dispute Score Modal ── */}
      {disputeModalOpen && challenge?.match_result && (() => {
        const mr = challenge.match_result
        const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = disputeScore
        const n = (v: string) => parseInt(v, 10) || 0
        const set1ChWon = s1ch && s1cd ? n(s1ch) > n(s1cd) : null
        const set2ChWon = s2ch && s2cd ? n(s2ch) > n(s2cd) : null
        const chSets = (set1ChWon ? 1 : 0) + (set2ChWon ? 1 : 0)
        const cdSets = ((set1ChWon === false) ? 1 : 0) + ((set2ChWon === false) ? 1 : 0)
        const needsTB = s1ch && s1cd && s2ch && s2cd && chSets === 1 && cdSets === 1
        const winner = chSets >= 2 ? challenge.challenging_team?.name
          : cdSets >= 2 ? challenge.challenged_team?.name
          : needsTB && tbch && tbcd ? (n(tbch) > n(tbcd) ? challenge.challenging_team?.name : challenge.challenged_team?.name)
          : null

        const setDs = (field: keyof typeof disputeScore) => (e: React.ChangeEvent<HTMLInputElement>) =>
          setDisputeScore(prev => ({ ...prev, [field]: e.target.value }))

        const DsRow = ({ label, chField, cdField }: { label: string; chField: keyof typeof disputeScore; cdField: keyof typeof disputeScore }) => (
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs font-semibold w-8 shrink-0 text-center">{label}</span>
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{challenge.challenging_team?.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={disputeScore[chField]} onChange={setDs(chField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
              <span className="text-slate-500 font-bold text-xl mt-6 shrink-0">–</span>
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{challenge.challenged_team?.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={disputeScore[cdField]} onChange={setDs(cdField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
            </div>
          </div>
        )

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
            onClick={e => { if (e.target === e.currentTarget) setDisputeModalOpen(false) }}>
            <div className="w-full sm:max-w-sm bg-slate-800 border border-orange-500/40 rounded-t-2xl sm:rounded-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-center sm:hidden">
                <div className="w-10 h-1 bg-slate-600 rounded-full" />
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-400" />
                    <h3 className="font-bold text-white text-lg">Dispute Score</h3>
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5">
                    Enter the correct score as you remember it.
                  </p>
                </div>
                <button onClick={() => setDisputeModalOpen(false)} className="text-slate-400 hover:text-white p-2 -mr-1 rounded-lg" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Their submitted score (for reference) */}
              <div className="p-3 bg-slate-700/40 border border-slate-600 rounded-xl">
                <p className="text-xs text-slate-400 mb-2 font-medium">Their submitted score (for reference)</p>
                <div className="flex gap-3 text-center justify-center text-sm text-slate-300">
                  <span>Set 1: {mr.set1_challenger ?? '—'}–{mr.set1_challenged ?? '—'}</span>
                  <span className="text-slate-600">|</span>
                  <span>Set 2: {mr.set2_challenger ?? '—'}–{mr.set2_challenged ?? '—'}</span>
                  {mr.supertiebreak_challenger != null && (
                    <>
                      <span className="text-slate-600">|</span>
                      <span>TB: {mr.supertiebreak_challenger}–{mr.supertiebreak_challenged}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <DsRow label="Set 1" chField="s1ch" cdField="s1cd" />
                <DsRow label="Set 2" chField="s2ch" cdField="s2cd" />
                {needsTB && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-slate-600" />
                      <span className="text-xs text-orange-400 font-semibold tracking-wide">SUPER TIEBREAK</span>
                      <div className="h-px flex-1 bg-slate-600" />
                    </div>
                    <DsRow label="TB" chField="tbch" cdField="tbcd" />
                  </div>
                )}
              </div>

              {winner ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <Trophy className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">Winner (your version)</p>
                    <p className="font-bold text-emerald-400">{winner}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-700/30 border border-slate-600/40 rounded-xl text-center">
                  <p className="text-slate-500 text-xs">Enter scores above to see winner</p>
                </div>
              )}

              <div className="flex gap-3 pb-1">
                <Button onClick={handleSubmitDisputeScore} disabled={disputeSubmitting || !winner}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 h-12 text-base font-semibold">
                  {disputeSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <AlertTriangle className="h-5 w-5 mr-2" />}
                  File Dispute
                </Button>
                <Button onClick={() => setDisputeModalOpen(false)} variant="outline" className="h-12 px-5 border-slate-600 text-slate-300">
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-slate-500 text-center pb-1">
                The opposing team will be asked to accept your version or it will escalate to admin review.
              </p>
            </div>
          </div>
        )
      })()}

      {/* ── Challenge History / Audit Trail ── */}
      <div className="mt-2">
        <button
          onClick={() => {
            const next = !showTimeline
            setShowTimeline(next)
            if (next) fetchEvents()
          }}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors py-2"
        >
          <History className="h-4 w-4" />
          <span>{showTimeline ? 'Hide' : 'Show'} challenge history</span>
          <span className="text-xs text-slate-600">({events.length > 0 ? `${events.length} events` : 'audit trail'})</span>
        </button>

        {showTimeline && (
          <Card className="bg-slate-800/50 border-slate-700 p-5 mt-1">
            {eventsLoading && (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading history...
              </div>
            )}
            {!eventsLoading && events.length === 0 && (
              <p className="text-center text-slate-500 text-sm py-4">No events recorded yet.</p>
            )}
            {!eventsLoading && events.length > 0 && (
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-700" />
                <ul className="space-y-4 pl-9">
                  {events.map((ev) => {
                    const colour = EVENT_COLOURS[ev.event_type as keyof typeof EVENT_COLOURS] ?? 'slate'
                    const label = EVENT_LABELS[ev.event_type as keyof typeof EVENT_LABELS] ?? ev.event_type.replace(/_/g, ' ')
                    const dotColour = ({
                      emerald: 'bg-emerald-500',
                      red: 'bg-red-500',
                      blue: 'bg-blue-500',
                      yellow: 'bg-yellow-500',
                      orange: 'bg-orange-500',
                      purple: 'bg-purple-500',
                      slate: 'bg-slate-500',
                    } as Record<string, string>)[colour] ?? 'bg-slate-500'
                    const textColour = ({
                      emerald: 'text-emerald-400',
                      red: 'text-red-400',
                      blue: 'text-blue-400',
                      yellow: 'text-yellow-400',
                      orange: 'text-orange-400',
                      purple: 'text-purple-400',
                      slate: 'text-slate-400',
                    } as Record<string, string>)[colour] ?? 'text-slate-400'
                    return (
                      <li key={ev.id} className="relative">
                        <span className={`absolute -left-6 top-1 w-2.5 h-2.5 rounded-full ring-2 ring-slate-800 ${dotColour}`} />
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
                          <div className="text-xs text-slate-400 mt-0.5">
                            {ev.actor_role === 'system' ? (
                              <span className="text-slate-500 italic">System</span>
                            ) : ev.actor_name ? (
                              <span>{ev.actor_name}{ev.actor_role === 'admin' && <span className="text-yellow-600 ml-1">(admin)</span>}</span>
                            ) : (
                              <span className="text-slate-600 italic">—</span>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Decline Confirmation Dialog ── */}
      {showDeclineConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <Card className="bg-slate-800 border-red-500/50 p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-red-400 flex-shrink-0" />
              <h3 className="font-semibold text-white text-lg">Declining = Forfeit</h3>
            </div>
            <p className="text-slate-300 text-sm">
              Declining a challenge is treated as a <strong className="text-red-400">forfeit</strong>. Your team will drop positions in the rankings.
            </p>
            <p className="text-slate-400 text-sm">
              If the timing doesn't work, consider using <strong className="text-purple-400">Propose Different Time</strong> instead.
            </p>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleDecline}
                disabled={actionLoading}
                variant="destructive"
                className="flex-1"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Yes, Decline &amp; Forfeit
              </Button>
              <Button
                onClick={() => setShowDeclineConfirm(false)}
                variant="outline"
                className="flex-1 border-slate-600"
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Forfeit confirmation modal ── */}
      {showForfeitConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <Card className="bg-slate-900 border-slate-700 p-6 max-w-sm w-full space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-white text-lg">Forfeit this challenge?</h3>
                <p className="text-slate-400 text-sm mt-1">
                  Your team will forfeit the challenge against{' '}
                  <span className="text-white font-medium">
                    {isChallengingTeam ? challenge.challenged_team?.name : challenge.challenging_team?.name}
                  </span>.
                </p>
              </div>
            </div>
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-1">
              <p className="text-sm text-red-300 font-medium">This counts as a forfeit against your team.</p>
              <p className="text-xs text-red-300/70">Your team will drop positions on the ladder. This cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowForfeitConfirm(false)}
                variant="outline"
                className="flex-1 border-slate-600 text-slate-300"
                disabled={forfeiting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleForfeit}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                disabled={forfeiting}
              >
                {forfeiting ? 'Forfeiting…' : 'Forfeit'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
