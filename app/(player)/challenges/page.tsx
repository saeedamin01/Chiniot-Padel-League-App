'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTeam } from '@/context/TeamContext'
import { toast } from 'sonner'
import { Clock, Zap, X, MapPin, Calendar, Ticket, AlertTriangle, ChevronRight, Trophy, Shield, CheckCircle, Loader2, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DateTimeSlotPicker } from '@/components/ui/DateTimeSlotPicker'
import type { Challenge, Venue, TicketType, Ticket as TicketT } from '@/types'

interface MatchResult {
  id: string
  winner_team_id: string
  loser_team_id: string
  reported_by_team_id: string | null
  verified_at: string | null
  auto_verified: boolean | null
  verify_deadline: string | null
  match_date: string | null
  set1_challenger: number | null
  set1_challenged: number | null
  set2_challenger: number | null
  set2_challenged: number | null
  supertiebreak_challenger: number | null
  supertiebreak_challenged: number | null
}

interface EnhancedChallenge extends Challenge {
  isOutgoing: boolean
  opponentTeamName: string
  opponentPlayerNames: string
  daysUntilDeadline: number
  matchResult?: MatchResult | null
}

interface OpponentInfo {
  id: string
  name: string
  rank: number | null
  tierName: string | null
  player1Name: string
  player2Name: string
}

export default function ChallengesPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeTeam } = useTeam()

  // Ticket type from URL — set by the ladder's challenge button for ticket challenges.
  // null means this is a normal challenge that doesn't require a ticket.
  const ticketParam = searchParams.get('ticket')

  const [loading, setLoading] = useState(true)
  const [challenges, setChallenges] = useState<EnhancedChallenge[]>([])
  const [seasonId, setSeasonId] = useState('')
  const [verifyLoading, setVerifyLoading] = useState<string | null>(null)

  // Forfeit state
  const [forfeitTarget, setForfeitTarget] = useState<{ id: string; code: string; opponent: string; myTeamId: string } | null>(null)
  const [forfeiting, setForfeiting] = useState(false)

  // Send challenge modal state
  const [showSendModal, setShowSendModal] = useState(false)
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null)
  const [slot1, setSlot1] = useState('')
  const [slot2, setSlot2] = useState('')
  const [slot3, setSlot3] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])

  // Ticket state — no toggle: ticket usage is determined automatically from URL param
  const [teamTickets, setTeamTickets] = useState<TicketT[]>([])

  // Slot requirements from settings
  const [slotReqs, setSlotReqs] = useState({
    eveningCount: 2,
    weekendCount: 1,
    eveningStartHour: 18,
    eveningEndHour: 21,
  })

  const fetchChallenges = useCallback(async (teamId: string) => {
    try {
      const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).single()
      if (!season) { setLoading(false); return }
      setSeasonId(season.id)

      // Load slot requirements
      const { data: settings } = await supabase
        .from('league_settings')
        .select('slot_evening_count, slot_weekend_count, slot_evening_start_hour, slot_evening_end_hour')
        .eq('season_id', season.id)
        .single()
      if (settings) {
        setSlotReqs({
          eveningCount: settings.slot_evening_count ?? 2,
          weekendCount: settings.slot_weekend_count ?? 1,
          eveningStartHour: settings.slot_evening_start_hour ?? 18,
          eveningEndHour: settings.slot_evening_end_hour ?? 21,
        })
      }

      // Load venues for the send-challenge modal
      const { data: venueData } = await supabase
        .from('venues')
        .select('*')
        .eq('season_id', season.id)
        .eq('is_active', true)
        .order('name')
      setVenues(venueData || [])

      // Fetch only challenges involving the currently active team
      const { data: allChallenges, error } = await supabase
        .from('challenges')
        .select(`*, challenging_team:teams!challenging_team_id(id, name, player1:players!player1_id(name), player2:players!player2_id(name)), challenged_team:teams!challenged_team_id(id, name, player1:players!player1_id(name), player2:players!player2_id(name)), match_result:match_results!challenge_id(id, winner_team_id, loser_team_id, reported_by_team_id, verified_at, auto_verified, verify_deadline, match_date, set1_challenger, set1_challenged, set2_challenger, set2_challenged, supertiebreak_challenger, supertiebreak_challenged)`)
        .eq('season_id', season.id)
        .or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)

      if (error) { setLoading(false); return }

      const enriched = (allChallenges || []).map(c => {
        const isOutgoing = c.challenging_team_id === teamId
        const deadline = new Date(isOutgoing ? c.match_deadline : c.accept_deadline)
        const daysUntil = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000))
        const rawResult = Array.isArray(c.match_result) ? c.match_result[0] : c.match_result
        const opponentTeam = isOutgoing ? c.challenged_team : c.challenging_team
        const p1 = (opponentTeam as any)?.player1?.name
        const p2 = (opponentTeam as any)?.player2?.name
        return {
          ...c,
          isOutgoing,
          opponentTeamName: (opponentTeam as any)?.name || 'Unknown',
          opponentPlayerNames: [p1, p2].filter(Boolean).join(' & '),
          daysUntilDeadline: daysUntil,
          matchResult: rawResult || null,
        }
      })

      setChallenges(enriched)
    } catch (err) {
      toast.error('Failed to load challenges')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Re-fetch and clear stale data whenever the active team changes
  useEffect(() => {
    if (!activeTeam) { setLoading(false); return }
    setLoading(true)
    setChallenges([])
    fetchChallenges(activeTeam.id)
  }, [activeTeam, fetchChallenges])

  // Load team's active tickets whenever the active team or season changes
  useEffect(() => {
    if (!activeTeam || !seasonId) return
    supabase
      .from('tickets')
      .select('*')
      .eq('team_id', activeTeam.id)
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .then(({ data }) => setTeamTickets(data || []))
  }, [activeTeam, seasonId, supabase])

  // Open send-challenge modal if ?opponent= is in URL
  useEffect(() => {
    const opponentId  = searchParams.get('opponent')
    const ticketParam = searchParams.get('ticket') // pre-selected ticket type from ladder
    if (!opponentId || !seasonId) return

    async function loadOpponent() {
      const { data } = await supabase
        .from('teams')
        .select(`
          id, name,
          player1:players!player1_id(name),
          player2:players!player2_id(name),
          ladder_position:ladder_positions!team_id(rank, tier:tiers!tier_id(name))
        `)
        .eq('id', opponentId)
        .single()

      if (!data) { toast.error('Opponent team not found'); return }

      const pos = Array.isArray(data.ladder_position) ? data.ladder_position[0] : data.ladder_position
      const tier = pos?.tier ? (Array.isArray(pos.tier) ? pos.tier[0] : pos.tier) : null
      setOpponent({
        id: data.id,
        name: data.name,
        rank: pos?.rank ?? null,
        tierName: (tier as any)?.name ?? null,
        player1Name: (data.player1 as any)?.name ?? '',
        player2Name: (data.player2 as any)?.name ?? '',
      })

      // If a ticket type was passed via URL (from the ladder's ticket-based challenge
      // button), pre-select it so the player doesn't have to manually toggle it on.
      setShowSendModal(true)
    }

    loadOpponent()
  }, [searchParams, seasonId, supabase])

  function validateSlots(s1: string, s2: string, s3: string): string | null {
    const slots = [s1, s2, s3].map(s => new Date(s))

    // 30-minute boundary check
    for (const [i, d] of slots.entries()) {
      if (d.getMinutes() % 30 !== 0) {
        return `Slot ${i + 1} must be on a :00 or :30 minute boundary (e.g. 18:00 or 18:30).`
      }
    }

    const { eveningCount, weekendCount, eveningStartHour, eveningEndHour } = slotReqs

    // Evening: hour >= start && hour < end (local time)
    const isEvening = (d: Date) => {
      const h = d.getHours()
      return h >= eveningStartHour && h < eveningEndHour
    }
    // Weekend: Sat (6) or Sun (0). Friday (5) is a weekday.
    const isWeekend = (d: Date) => [0, 6].includes(d.getDay())

    const eveningSlots = slots.filter(isEvening).length
    const weekendSlots = slots.filter(isWeekend).length

    if (eveningSlots < eveningCount) {
      const fmtHour = (h: number) => {
        if (h === 0) return '12:00 AM'
        if (h < 12) return `${h}:00 AM`
        if (h === 12) return '12:00 PM'
        return `${h - 12}:00 PM`
      }
      return `At least ${eveningCount} slot${eveningCount !== 1 ? 's' : ''} must be in the evening (${fmtHour(eveningStartHour)} – ${fmtHour(eveningEndHour)}). You provided ${eveningSlots}.`
    }
    if (weekendSlots < weekendCount) {
      return `At least ${weekendCount} slot${weekendCount !== 1 ? 's' : ''} must be on a weekend (Saturday or Sunday). You provided ${weekendSlots}.`
    }
    return null
  }

  async function doSendChallenge() {
    setSendError('')
    if (!activeTeam) { setSendError('No active team selected. Switch teams in the navbar.'); return }
    if (!opponent) return
    // DateTimeSlotPicker emits "YYYY-MM-DDTHH:MM" only when both date AND time are chosen
    const slotComplete = (s: string) => { const [d, t] = s.split('T'); return !!d && !!t && t.length === 5 }
    if (!slotComplete(slot1) || !slotComplete(slot2) || !slotComplete(slot3)) {
      setSendError('Please choose a date and time for all 3 slots.')
      return
    }

    const slotValidationError = validateSlots(slot1, slot2, slot3)
    if (slotValidationError) { setSendError(slotValidationError); return }

    // Ticket type is determined by the URL param (set by the ladder's challenge button)
    // — not by a toggle. If ?ticket=silver|gold|tier was in the URL, use it.
    const finalTicketType = (ticketParam && ['tier', 'silver', 'gold'].includes(ticketParam))
      ? ticketParam as TicketType
      : null

    setSending(true)
    try {
      const res = await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengingTeamId: activeTeam.id,
          challengedTeamId: opponent.id,
          slot1: new Date(slot1).toISOString(),
          slot2: new Date(slot2).toISOString(),
          slot3: new Date(slot3).toISOString(),
          ticketType: finalTicketType || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) { setSendError(data.error || 'Failed to send challenge'); return }

      const ticketMsg = finalTicketType ? ` using your ${finalTicketType} ticket` : ''
      toast.success(`Challenge sent to ${opponent.name}${ticketMsg}!`)
      setShowSendModal(false)
      setSlot1(''); setSlot2(''); setSlot3(''); setSendError('')
      router.replace('/challenges')
      if (activeTeam) fetchChallenges(activeTeam.id)
    } catch (err) {
      setSendError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  async function handleSendChallenge() {
    await doSendChallenge()
  }

  async function handleVerifyMatch(matchResultId: string, myTeamId: string, action: 'verify' | 'dispute') {
    setVerifyLoading(matchResultId + ':' + action)
    try {
      const res = await fetch(`/api/matches/${matchResultId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamId: myTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed'); return }
      toast.success(action === 'verify' ? 'Result verified! Rankings updated.' : 'Result disputed — admin will review.')
      if (activeTeam) fetchChallenges(activeTeam.id)
    } catch { toast.error('An error occurred') }
    finally { setVerifyLoading(null) }
  }

  async function handleForfeit() {
    if (!forfeitTarget) return
    setForfeiting(true)
    try {
      const res = await fetch(`/api/challenges/${forfeitTarget.id}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forfeitingTeamId: forfeitTarget.myTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to forfeit'); return }
      toast.success('Challenge forfeited.')
      setForfeitTarget(null)
      if (activeTeam) fetchChallenges(activeTeam.id)
    } catch { toast.error('An error occurred') }
    finally { setForfeiting(false) }
  }

  // Small "Forfeit challenge" link shown at the bottom of each active card.
  // Opens the shared confirmation dialog.
  const ForfeitTrigger = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const myTeamId = challenge.isOutgoing
      ? challenge.challenging_team_id
      : challenge.challenged_team_id
    return (
      <button
        onClick={() => setForfeitTarget({
          id: challenge.id,
          code: challenge.challenge_code,
          opponent: challenge.opponentTeamName,
          myTeamId,
        })}
        className="w-full mt-2 text-xs text-red-400/60 hover:text-red-400 transition-colors text-center py-0.5"
      >
        Forfeit challenge
      </button>
    )
  }

  // ── Section derivations ────────────────────────────────────────────────
  const needsAction = challenges.filter(c => {
    if (['played', 'forfeited', 'dissolved', 'scheduled'].includes(c.status)) return false
    if (c.status === 'pending'              && !c.isOutgoing) return true  // incoming: accept/decline
    if (c.status === 'accepted_open'        && !c.isOutgoing) return true  // accepted open: enter time
    if (c.status === 'time_pending_confirm' &&  c.isOutgoing) return true  // opponent proposed time: confirm
    // NOTE: 'accepted' (slot-pick) now goes directly to 'scheduled', so it never needs
    // action from the challenger. Kept here only for legacy data in the old status.
    if (c.status === 'accepted'             &&  c.isOutgoing) return true
    return false
  })

  const activeChallenges = challenges.filter(c => {
    if (['played', 'forfeited', 'dissolved', 'scheduled'].includes(c.status)) return false
    return !needsAction.includes(c)
  })

  const upcomingMatches    = challenges.filter(c => c.status === 'scheduled')
  const matchHistory       = challenges.filter(c => ['played', 'forfeited'].includes(c.status))
  const dissolvedChallenges = challenges.filter(c => c.status === 'dissolved')

  // Pending verification: played but result not yet verified, and I'm not the one who reported it
  const pendingVerification = matchHistory.filter(c => {
    const mr = c.matchResult
    if (!mr) return false
    if (mr.verified_at || mr.auto_verified) return false
    const myTeamId = c.isOutgoing ? c.challenging_team_id : c.challenged_team_id
    return mr.reported_by_team_id !== myTeamId
  })

  // Stats — verified results + forfeits both count
  const verifiedHistory = matchHistory.filter(c => {
    const mr = c.matchResult
    return mr && (mr.verified_at || mr.auto_verified)
  })
  // Forfeited challenges where I was the one who forfeited (= a loss with no result record)
  const forfeitLosses = matchHistory.filter(c => {
    if (c.status !== 'forfeited' || !c.forfeit_by) return false
    const myTeamId = c.isOutgoing ? c.challenging_team_id : c.challenged_team_id
    const forfeitingTeamId = c.forfeit_by === 'challenger' ? c.challenging_team_id : c.challenged_team_id
    return forfeitingTeamId === myTeamId
  })

  const statsWins   = verifiedHistory.filter(c => c.matchResult?.winner_team_id === (c.isOutgoing ? c.challenging_team_id : c.challenged_team_id)).length
  const statsLosses = (verifiedHistory.length - statsWins) + forfeitLosses.length
  const statsTotal  = verifiedHistory.length + forfeitLosses.length
  const statsWinPct = statsTotal > 0 ? Math.round((statsWins / statsTotal) * 100) : 0

  // ── Status badge helper ─────────────────────────────────────────────────
  function statusBadge(challenge: EnhancedChallenge) {
    const map: Record<string, { label: string; cls: string }> = {
      pending:                  { label: 'Pending',       cls: 'bg-yellow-500/20 text-yellow-300' },
      accepted:                 { label: 'Time Set',      cls: 'bg-orange-500/20 text-orange-300' },
      accepted_open:            { label: 'Time TBD',      cls: 'bg-amber-500/20  text-amber-300'  },
      time_pending_confirm:     { label: 'Time Proposed', cls: 'bg-orange-500/20 text-orange-300' },
      reschedule_requested:     { label: 'Reschedule',    cls: 'bg-purple-500/20 text-purple-300' },
      reschedule_pending_admin: { label: 'Admin Review',  cls: 'bg-indigo-500/20 text-indigo-300' },
      revision_proposed:        { label: 'Rev. Proposed', cls: 'bg-purple-500/20 text-purple-300' },
      scheduled:                { label: 'Scheduled',     cls: 'bg-blue-500/20   text-blue-300'   },
      played:                   { label: 'Played',        cls: 'bg-green-500/20  text-green-300'  },
      forfeited:                { label: 'Forfeited',     cls: 'bg-red-500/20    text-red-300'    },
      dissolved:                { label: 'Dissolved',     cls: 'bg-slate-500/20  text-slate-400'  },
    }
    const e = map[challenge.status] ?? { label: challenge.status, cls: 'bg-slate-500/20 text-slate-400' }
    return <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${e.cls}`}>{e.label}</span>
  }

  // ── Needs-action card ──────────────────────────────────────────────────
  const ActionCard = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const actionMap: Record<string, string> = {
      'pending-incoming':              'Accept or decline this challenge',
      'accepted_open-incoming':        'Enter the agreed match time',
      'time_pending_confirm-outgoing': 'Opponent proposed a time — confirm it',
      'accepted-outgoing':             'Opponent accepted a slot — confirm the time',
    }
    const key = `${challenge.status}-${challenge.isOutgoing ? 'outgoing' : 'incoming'}`
    const actionText = actionMap[key] ?? 'Action required'
    return (
      <Card className="bg-amber-950/30 border-amber-500/40 p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="mt-0.5 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white">{challenge.opponentTeamName}</h3>
              <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{challenge.challenge_code}</code>
              {statusBadge(challenge)}
            </div>
            {challenge.opponentPlayerNames && (
              <p className="text-xs text-slate-500 mt-0.5">{challenge.opponentPlayerNames}</p>
            )}
            <p className="text-sm text-amber-300 mt-1">{actionText}</p>
            {challenge.daysUntilDeadline > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">{challenge.daysUntilDeadline}d until deadline</p>
            )}
          </div>
        </div>
        <Link href={`/challenges/${challenge.id}`}>
          <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold">
            Take Action →
          </Button>
        </Link>
        <ForfeitTrigger challenge={challenge} />
      </Card>
    )
  }

  // ── Pending-verification card ──────────────────────────────────────────
  const VerifyCard = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const mr = challenge.matchResult!
    const myTeamId = challenge.isOutgoing ? challenge.challenging_team_id : challenge.challenged_team_id
    const isVLoading = (a: string) => verifyLoading === mr.id + ':' + a

    // Build challenger-perspective score string for display
    const scoreParts = [
      mr.set1_challenger != null ? `${mr.set1_challenger}–${mr.set1_challenged}` : null,
      mr.set2_challenger != null ? `${mr.set2_challenger}–${mr.set2_challenged}` : null,
      mr.supertiebreak_challenger != null ? `[${mr.supertiebreak_challenger}–${mr.supertiebreak_challenged}]` : null,
    ].filter(Boolean).join(', ')

    return (
      <Card className="bg-slate-800/60 border-yellow-500/30 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                Pending Verification
              </span>
            </div>
            <p className="font-semibold text-white">
              vs <span className="text-emerald-400">{challenge.opponentTeamName}</span>
            </p>
            {mr.match_date && (
              <p className="text-slate-400 text-xs">{(() => { const d = new Date(mr.match_date); const wd = d.toLocaleDateString('en-GB', { weekday: 'short' }); return `${wd} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })()}</p>
            )}
            <p className="text-slate-300 text-xs font-mono mt-0.5">
              {challenge.challenging_team?.name ?? 'Challenger'}: {scoreParts}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">
              Reported winner: <span className="text-white font-medium">
                {mr.winner_team_id === (challenge.isOutgoing ? challenge.challenging_team_id : challenge.challenged_team_id)
                  ? 'You'
                  : challenge.opponentTeamName}
              </span>
            </p>
          </div>
          {mr.verify_deadline && (
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-500 mb-0.5">Auto-verifies in</p>
              <VerifyCountdown deadline={mr.verify_deadline} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            onClick={() => handleVerifyMatch(mr.id, myTeamId, 'verify')}
            disabled={!!verifyLoading}
            className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 font-semibold"
          >
            {isVLoading('verify') ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Verify Result
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleVerifyMatch(mr.id, myTeamId, 'dispute')}
            disabled={!!verifyLoading}
            className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 h-10 text-xs"
          >
            {isVLoading('dispute') ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
            Dispute Score
          </Button>
        </div>
      </Card>
    )
  }

  // ── Active challenge card ──────────────────────────────────────────────
  const ChallengeCard = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const waitMap: Record<string, string> = {
      'pending-outgoing':              'Waiting for opponent to accept',
      'accepted_open-outgoing':        'Waiting for opponent to enter a time',
      'time_pending_confirm-incoming': 'You proposed a time — waiting for challenger to confirm',
      'accepted-incoming':             'You accepted a slot — waiting for challenger to confirm',
      'reschedule_requested-outgoing': 'Reschedule request sent — waiting for response',
      'reschedule_requested-incoming': 'Reschedule requested by opponent',
      'reschedule_pending_admin-outgoing': 'Reschedule awaiting admin approval',
      'reschedule_pending_admin-incoming': 'Reschedule awaiting admin approval',
      'revision_proposed-outgoing': 'Revision proposed — waiting for response',
      'revision_proposed-incoming': 'Revision proposed by opponent',
    }
    const key = `${challenge.status}-${challenge.isOutgoing ? 'outgoing' : 'incoming'}`
    const waitText = waitMap[key] ?? 'In progress'
    return (
      <Card className="bg-slate-800/60 border-slate-700/50 p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white truncate">{challenge.opponentTeamName}</h3>
              <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{challenge.challenge_code}</code>
            </div>
            {challenge.opponentPlayerNames && (
              <p className="text-xs text-slate-500 mt-0.5">{challenge.opponentPlayerNames}</p>
            )}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-xs ${challenge.isOutgoing ? 'text-blue-400' : 'text-yellow-400'}`}>
                {challenge.isOutgoing ? '↑ Sent' : '↓ Received'}
              </span>
              {statusBadge(challenge)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-3">
          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span>{waitText}</span>
        </div>
        {challenge.daysUntilDeadline > 0 && (
          <p className="text-xs text-slate-500 mb-3">{challenge.daysUntilDeadline}d until deadline</p>
        )}
        <Link href={`/challenges/${challenge.id}`}>
          <Button variant="ghost" size="sm" className="w-full">View Details</Button>
        </Link>
        <ForfeitTrigger challenge={challenge} />
      </Card>
    )
  }

  // ── Upcoming match card ────────────────────────────────────────────────
  const UpcomingCard = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const matchTime = challenge.confirmed_time || challenge.accepted_slot
    const formattedDate = matchTime
      ? new Date(matchTime).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
      : 'Date TBC'
    const formattedTime = matchTime
      ? new Date(matchTime).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
      : ''
    return (
      <Card className="bg-slate-800/60 border-blue-500/30 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
            <Calendar className="h-5 w-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-semibold text-white">{challenge.opponentTeamName}</h3>
              <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{challenge.challenge_code}</code>
            </div>
            {challenge.opponentPlayerNames && (
              <p className="text-xs text-slate-500 -mt-0.5 mb-0.5">{challenge.opponentPlayerNames}</p>
            )}
            <p className="text-sm font-medium text-blue-300">
              {formattedDate}{formattedTime && ` · ${formattedTime}`}
            </p>
            {challenge.match_location && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 text-slate-500" />
                <span className="text-xs text-slate-400">{challenge.match_location}</span>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <Link href={`/challenges/${challenge.id}`}>
            <Button variant="ghost" size="sm" className="w-full">View Details</Button>
          </Link>
          <ForfeitTrigger challenge={challenge} />
        </div>
      </Card>
    )
  }

  // ── History card ───────────────────────────────────────────────────────
  const HistoryCard = ({ challenge }: { challenge: EnhancedChallenge }) => {
    const mr = challenge.matchResult
    const myTeamId = challenge.isOutgoing ? challenge.challenging_team_id : challenge.challenged_team_id
    const isWin = mr ? mr.winner_team_id === myTeamId : null
    const isForfeited = challenge.status === 'forfeited'
    const isDissolved = challenge.status === 'dissolved'

    let scoreStr = ''
    if (mr) {
      const myS1   = challenge.isOutgoing ? mr.set1_challenger          : mr.set1_challenged
      const oppS1  = challenge.isOutgoing ? mr.set1_challenged          : mr.set1_challenger
      const myS2   = challenge.isOutgoing ? mr.set2_challenger          : mr.set2_challenged
      const oppS2  = challenge.isOutgoing ? mr.set2_challenged          : mr.set2_challenger
      const mySTB  = challenge.isOutgoing ? mr.supertiebreak_challenger : mr.supertiebreak_challenged
      const oppSTB = challenge.isOutgoing ? mr.supertiebreak_challenged : mr.supertiebreak_challenger
      if (myS1 !== null && oppS1 !== null) {
        scoreStr = `${myS1}–${oppS1}`
        if (myS2 !== null && oppS2 !== null) {
          scoreStr += `, ${myS2}–${oppS2}`
          if (mySTB !== null && oppSTB !== null) scoreStr += ` [${mySTB}–${oppSTB}]`
        }
      }
    }

    return (
      <Card className={`p-4 border ${
        isForfeited || isDissolved ? 'bg-slate-800/40 border-slate-700/30' :
        isWin ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-red-950/20 border-red-500/20'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isForfeited || isDissolved ? 'bg-slate-700/50' :
            isWin ? 'bg-emerald-500/20' : 'bg-red-500/20'
          }`}>
            {isForfeited || isDissolved
              ? <X className="h-4 w-4 text-slate-400" />
              : isWin
                ? <Trophy className="h-4 w-4 text-emerald-400" />
                : <Shield className="h-4 w-4 text-red-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-white truncate">{challenge.opponentTeamName}</h3>
              <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{challenge.challenge_code}</code>
            </div>
            {challenge.opponentPlayerNames && (
              <p className="text-xs text-slate-500 mt-0.5">{challenge.opponentPlayerNames}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {isForfeited ? (
                <span className="text-xs text-slate-400">Forfeited</span>
              ) : isDissolved ? (
                <span className="text-xs text-slate-400">
                  Dissolved{challenge.dissolved_reason ? ` · ${challenge.dissolved_reason}` : ''}
                </span>
              ) : isWin !== null ? (
                <span className={`text-xs font-semibold ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isWin ? 'Win' : 'Loss'}
                </span>
              ) : null}
              {scoreStr && <span className="text-xs text-slate-300 font-mono">{scoreStr}</span>}
            </div>
          </div>
          <Link href={`/challenges/${challenge.id}`}>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white px-2">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="bg-slate-800/50 rounded-lg h-24 animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Challenges</h1>
          <p className="text-slate-400 mt-1">
            {activeTeam ? <>Acting as <span className="text-emerald-400 font-medium">{activeTeam.name}</span></> : 'Manage your matches and challenges'}
          </p>
        </div>
        <Link href="/ladder">
          <Button className="bg-emerald-500 hover:bg-emerald-600">
            <Zap className="h-4 w-4 mr-2" />Send Challenge
          </Button>
        </Link>
      </div>

      {/* ── Needs Your Attention ── */}
      {(needsAction.length > 0 || pendingVerification.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 className="text-xs font-semibold text-amber-300 uppercase tracking-widest">Needs Your Attention</h2>
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full text-xs font-medium">
              {needsAction.length + pendingVerification.length}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingVerification.map(c => <VerifyCard key={c.id} challenge={c} />)}
            {needsAction.map(c => <ActionCard key={c.id} challenge={c} />)}
          </div>
        </section>
      )}

      {/* ── Active Challenges ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-slate-400" />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Challenges</h2>
          {activeChallenges.length > 0 && (
            <span className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs font-medium">{activeChallenges.length}</span>
          )}
        </div>
        {activeChallenges.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {activeChallenges.map(c => <ChallengeCard key={c.id} challenge={c} />)}
          </div>
        ) : (
          <Card className="bg-slate-800/40 border-slate-700/30 p-6 text-center">
            <p className="text-slate-500 text-sm">No active challenges</p>
            <Link href="/ladder">
              <Button variant="ghost" size="sm" className="mt-2 text-emerald-400 hover:text-emerald-300">
                Go to the ladder to send one →
              </Button>
            </Link>
          </Card>
        )}
      </section>

      {/* ── Upcoming Matches ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-400" />
          <h2 className="text-xs font-semibold text-blue-300 uppercase tracking-widest">Upcoming Matches</h2>
          {upcomingMatches.length > 0 && (
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full text-xs font-medium">{upcomingMatches.length}</span>
          )}
        </div>
        {upcomingMatches.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {upcomingMatches.map(c => <UpcomingCard key={c.id} challenge={c} />)}
          </div>
        ) : (
          <Card className="bg-slate-800/40 border-slate-700/30 p-6 text-center">
            <p className="text-slate-500 text-sm">No upcoming matches scheduled yet</p>
          </Card>
        )}
      </section>

      {/* ── Match History ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-slate-400" />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Match History</h2>
          {matchHistory.length > 0 && (
            <span className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs font-medium">{matchHistory.length}</span>
          )}
        </div>

        {/* Stats bar */}
        {statsTotal > 0 && (
          <div className="grid grid-cols-4 gap-2">
            <Card className="bg-slate-800/60 border-slate-700/50 p-3 text-center">
              <p className="text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Played</p>
              <p className="text-xl font-bold text-white">{statsTotal}</p>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700/50 p-3 text-center">
              <p className="text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Wins</p>
              <p className="text-xl font-bold text-emerald-400">{statsWins}</p>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700/50 p-3 text-center">
              <p className="text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Losses</p>
              <p className="text-xl font-bold text-red-400">{statsLosses}</p>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700/50 p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <TrendingUp className="h-3 w-3 text-blue-400" />
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Win %</p>
              </div>
              <p className="text-xl font-bold text-blue-400">{statsWinPct}%</p>
            </Card>
          </div>
        )}

        {/* Waiting-for-opponent-to-report (played, but they haven't reported yet, or I reported and waiting) */}
        {matchHistory.filter(c => {
          const mr = c.matchResult
          if (!mr) return false
          if (mr.verified_at || mr.auto_verified) return false
          const myTeamId = c.isOutgoing ? c.challenging_team_id : c.challenged_team_id
          return mr.reported_by_team_id === myTeamId // I reported, waiting for them to verify
        }).map(c => (
          <Card key={c.id} className="bg-slate-800/40 border-slate-700/30 p-4 flex items-center gap-3">
            <Clock className="h-4 w-4 text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium">vs {c.opponentTeamName}</p>
              <p className="text-xs text-blue-300">Result submitted — waiting for opponent to verify</p>
            </div>
            {c.matchResult?.verify_deadline && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-500">Auto-verifies in</p>
                <VerifyCountdown deadline={c.matchResult.verify_deadline} />
              </div>
            )}
          </Card>
        ))}

        {(() => {
          // Show a card for: verified results, forfeits without a result row,
          // and played challenges with no result yet (edge case).
          const historyCards = matchHistory.filter(c =>
            c.matchResult?.verified_at ||
            c.matchResult?.auto_verified ||
            (c.status === 'forfeited' && !c.matchResult)
          )
          if (historyCards.length > 0) {
            return (
              <div className="grid gap-3 md:grid-cols-2">
                {historyCards.map(c => <HistoryCard key={c.id} challenge={c} />)}
              </div>
            )
          }
          if (matchHistory.length === 0) {
            return (
              <Card className="bg-slate-800/40 border-slate-700/30 p-6 text-center">
                <p className="text-slate-500 text-sm">No completed matches yet</p>
              </Card>
            )
          }
          return null
        })()}
      </section>

      {/* ── Dissolved Challenges ── */}
      {dissolvedChallenges.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <X className="h-4 w-4 text-slate-500" />
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Dissolved Challenges</h2>
            <span className="px-2 py-0.5 bg-slate-800 text-slate-500 rounded-full text-xs font-medium">{dissolvedChallenges.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {dissolvedChallenges.map(c => <HistoryCard key={c.id} challenge={c} />)}
          </div>
        </section>
      )}

      {/* Send Challenge Modal */}
      <Dialog open={showSendModal} onOpenChange={(open) => {
        setShowSendModal(open)
        if (!open) { router.replace('/challenges'); setSendError('') }
      }}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Zap className="h-5 w-5 text-emerald-400" />
              Send Challenge
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {activeTeam && opponent
                ? <><span className="text-white font-medium">{activeTeam.name}</span> → <span className="text-white font-medium">{opponent.name}</span> {opponent.rank ? `(#${opponent.rank})` : ''}</>
                : 'Send a challenge to this team'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 min-h-0 pr-1">
          {!activeTeam ? (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-sm">
              No active team selected. Use the team switcher in the navbar first.
            </div>
          ) : (
            <div className="space-y-4">
              {/* ── Contextual ticket banner (no toggle — automatic) ── */}
              {(() => {
                const isTicketChallenge = !!(ticketParam && ['tier', 'silver', 'gold'].includes(ticketParam))
                const ticketLabel = ticketParam
                  ? ticketParam.charAt(0).toUpperCase() + ticketParam.slice(1)
                  : null
                if (isTicketChallenge && ticketLabel) {
                  return (
                    <div className="flex items-start gap-2.5 p-3.5 bg-violet-500/10 border border-violet-500/30 rounded-xl">
                      <Ticket className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-violet-300">
                        This challenge uses your{' '}
                        <span className="font-semibold text-white">{ticketLabel} ticket</span>.
                      </p>
                    </div>
                  )
                }
                if (!isTicketChallenge && teamTickets.length > 0) {
                  const ticketNames = teamTickets
                    .map(t => t.ticket_type.charAt(0).toUpperCase() + t.ticket_type.slice(1))
                    .join(' + ')
                  return (
                    <div className="flex items-start gap-2.5 p-3.5 bg-slate-700/50 border border-slate-600/50 rounded-xl">
                      <Ticket className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-slate-300">
                        You have a <span className="font-semibold text-white">{ticketNames} ticket</span> — this challenge won't use it.
                      </p>
                    </div>
                  )
                }
                return null
              })()}

              {sendError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">{sendError}</div>
              )}

              {/* Opponent info */}
              {opponent && (
                <div className="p-3 bg-slate-800 rounded-lg text-sm">
                  <p className="text-slate-400">Challenging</p>
                  <p className="text-white font-medium">{opponent.name} {opponent.tierName && <span className="text-slate-400">· {opponent.tierName}</span>}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{opponent.player1Name} & {opponent.player2Name}</p>
                </div>
              )}

              {/* Slot requirements notice */}
              <div className="p-3 bg-slate-800/80 border border-slate-600 rounded-lg space-y-1">
                <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">Slot Requirements</p>
                {slotReqs.eveningCount > 0 && (
                  <div className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>
                      {slotReqs.eveningCount} × evening slot{slotReqs.eveningCount !== 1 ? 's' : ''} —{' '}
                      {(() => {
                        const fmtH = (h: number) => h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`
                        return `${fmtH(slotReqs.eveningStartHour)} to ${fmtH(slotReqs.eveningEndHour)}`
                      })()}
                    </span>
                  </div>
                )}
                {slotReqs.weekendCount > 0 && (
                  <div className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>{slotReqs.weekendCount} × weekend slot{slotReqs.weekendCount !== 1 ? 's' : ''} — Saturday or Sunday</span>
                  </div>
                )}
                <p className="text-xs text-slate-500 pt-1">Note: Friday is treated as a weekday</p>
              </div>

              {/* Slot 1 */}
              <div>
                <Label className="text-slate-300 text-sm">Slot 1 <span className="text-red-400">*</span></Label>
                <div className="mt-1">
                  <DateTimeSlotPicker value={slot1} onChange={setSlot1} />
                </div>
              </div>

              {/* Slot 2 */}
              <div>
                <Label className="text-slate-300 text-sm">Slot 2 <span className="text-red-400">*</span></Label>
                <div className="mt-1">
                  <DateTimeSlotPicker value={slot2} onChange={setSlot2} />
                </div>
              </div>

              {/* Slot 3 */}
              <div>
                <Label className="text-slate-300 text-sm">Slot 3 <span className="text-red-400">*</span></Label>
                <div className="mt-1">
                  <DateTimeSlotPicker value={slot3} onChange={setSlot3} />
                </div>
              </div>

              {/* How scheduling works */}
              <div className="p-3 bg-slate-800/60 border border-slate-600/50 rounded-lg text-xs text-slate-400 space-y-1">
                <p className="text-slate-300 font-medium text-xs">How it works</p>
                <p>1. You send this challenge with 3 suggested time slots.</p>
                <p>2. The other team either picks one of your slots (match immediately confirmed) or accepts and arranges a different time over WhatsApp.</p>
                <p>3. If they use WhatsApp, either team enters the agreed time in the app and you confirm it.</p>
              </div>

              <Button
                onClick={handleSendChallenge}
                disabled={sending}
                className="w-full bg-emerald-500 hover:bg-emerald-600"
              >
                {sending
                  ? 'Sending...'
                  : (ticketParam && ['tier', 'silver', 'gold'].includes(ticketParam))
                    ? `Send ${ticketParam.charAt(0).toUpperCase() + ticketParam.slice(1)} Ticket Challenge`
                    : 'Send Challenge'
                }
              </Button>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Forfeit confirmation dialog ── */}
      <Dialog open={!!forfeitTarget} onOpenChange={(open) => { if (!open) setForfeitTarget(null) }}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Forfeit Challenge
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {forfeitTarget && (
                <>
                  <span className="text-white font-medium">{forfeitTarget.code}</span> vs{' '}
                  <span className="text-white font-medium">{forfeitTarget.opponent}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-1.5">
              <p className="text-sm text-red-300 font-medium">This will count as a forfeit against your team.</p>
              <p className="text-xs text-red-300/70">Your team will drop positions on the ladder. This cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300"
                onClick={() => setForfeitTarget(null)} disabled={forfeiting}>
                Cancel
              </Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleForfeit} disabled={forfeiting}>
                {forfeiting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {forfeiting ? 'Forfeiting…' : 'Forfeit'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Verify deadline countdown ─────────────────────────────────────────────────
function VerifyCountdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = React.useState(Math.max(0, new Date(deadline).getTime() - Date.now()))
  React.useEffect(() => {
    const id = setInterval(() => setRemaining(r => Math.max(0, r - 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  if (remaining === 0) return <span className="text-xs text-red-400 font-mono">Expired</span>
  const h = Math.floor(remaining / 3_600_000)
  const m = Math.floor((remaining % 3_600_000) / 60_000)
  const s = Math.floor((remaining % 60_000) / 1000)
  return (
    <span className={`text-xs font-mono font-semibold ${h < 1 ? 'text-orange-400' : 'text-slate-300'}`}>
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}
