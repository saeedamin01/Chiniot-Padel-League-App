'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, Trophy, Calendar, MapPin, ArrowLeft, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ChallengeInfo {
  id: string
  challenge_code: string
  challenging_team_id: string
  challenged_team_id: string
  match_date?: string | null
  match_location?: string | null
  accepted_slot?: string | null
  challenging_team: { name: string }
  challenged_team: { name: string }
}

export default function ReportMatchPage() {
  const params = useParams()
  const router = useRouter()
  const challengeId = params.id as string
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)

  // Score inputs
  const [set1Ch, setSet1Ch] = useState('')
  const [set1Cd, setSet1Cd] = useState('')
  const [set2Ch, setSet2Ch] = useState('')
  const [set2Cd, setSet2Cd] = useState('')
  const [stbCh, setStbCh] = useState('')
  const [stbCd, setStbCd] = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [matchLocation, setMatchLocation] = useState('')

  const fetchChallenge = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: season } = await supabase
        .from('seasons')
        .select('id')
        .eq('is_active', true)
        .single()

      if (!season) { toast.error('No active season'); return }

      // Get user's team in this season
      const { data: userTeams } = await supabase
        .from('teams')
        .select('id')
        .eq('season_id', season.id)
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

      const myTeamIds = userTeams?.map(t => t.id) ?? []

      // Fetch challenge
      const { data, error } = await supabase
        .from('challenges')
        .select(`
          id, challenge_code, challenging_team_id, challenged_team_id,
          match_date, match_location, accepted_slot, status,
          challenging_team:teams!challenging_team_id(name),
          challenged_team:teams!challenged_team_id(name)
        `)
        .eq('id', challengeId)
        .single()

      if (error || !data) {
        toast.error('Challenge not found')
        router.push('/challenges')
        return
      }

      if (data.status !== 'scheduled') {
        toast.error('This match is not scheduled yet')
        router.push(`/challenges/${challengeId}`)
        return
      }

      // Only the challenging team can report
      if (!myTeamIds.includes(data.challenging_team_id)) {
        toast.error('Only the challenging team can report the result')
        router.push(`/challenges/${challengeId}`)
        return
      }

      setChallenge(data as any)
      setMyTeamId(data.challenging_team_id)

      // Pre-fill match date from scheduled time if available
      const scheduledAt = data.match_date ?? data.accepted_slot
      if (scheduledAt) {
        // Convert to local datetime-local input format
        const d = new Date(scheduledAt)
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        setMatchDate(local)
      }
      if (data.match_location) setMatchLocation(data.match_location)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load challenge')
      router.push('/challenges')
    } finally {
      setLoading(false)
    }
  }, [challengeId, router, supabase])

  useEffect(() => { fetchChallenge() }, [fetchChallenge])

  // Determine if supertiebreak is needed (sets are 1-1)
  const s1ch = parseInt(set1Ch) || 0
  const s1cd = parseInt(set1Cd) || 0
  const s2ch = parseInt(set2Ch) || 0
  const s2cd = parseInt(set2Cd) || 0

  const set1Done = set1Ch !== '' && set1Cd !== ''
  const set2Done = set2Ch !== '' && set2Cd !== ''

  const challengerSets =
    (set1Done && s1ch > s1cd ? 1 : 0) + (set2Done && s2ch > s2cd ? 1 : 0)
  const challengedSets =
    (set1Done && s1cd > s1ch ? 1 : 0) + (set2Done && s2cd > s2ch ? 1 : 0)

  const needsSupertiebreak = set1Done && set2Done && challengerSets === 1 && challengedSets === 1

  // Determine winner label for preview
  let winnerLabel = ''
  if (set1Done && set2Done) {
    if (challengerSets === 2) {
      winnerLabel = challenge?.challenging_team?.name ?? 'Challenging team'
    } else if (challengedSets === 2) {
      winnerLabel = challenge?.challenged_team?.name ?? 'Challenged team'
    } else if (needsSupertiebreak && stbCh !== '' && stbCd !== '') {
      const stbch = parseInt(stbCh) || 0
      const stbcd = parseInt(stbCd) || 0
      winnerLabel = stbch > stbcd
        ? (challenge?.challenging_team?.name ?? 'Challenging team')
        : (challenge?.challenged_team?.name ?? 'Challenged team')
    }
  }

  const handleSubmit = async () => {
    if (!challenge || !myTeamId) return

    // Validate scores
    if (!set1Ch || !set1Cd || !set2Ch || !set2Cd) {
      toast.error('Please enter scores for both sets')
      return
    }
    if (needsSupertiebreak && (!stbCh || !stbCd)) {
      toast.error('Sets are 1-1 — please enter the super tiebreak score')
      return
    }
    if (!matchDate) {
      toast.error('Please enter the match date')
      return
    }

    // Sanity check: scores must produce a winner (no 1-1 tie without supertiebreak)
    if (set1Done && set2Done && challengerSets !== 2 && challengedSets !== 2 && !needsSupertiebreak) {
      toast.error('Invalid scores — please check set results')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.id,
          reportingTeamId: myTeamId,
          set1Challenger: parseInt(set1Ch),
          set1Challenged: parseInt(set1Cd),
          set2Challenger: parseInt(set2Ch),
          set2Challenged: parseInt(set2Cd),
          supertiebreakChallenger: stbCh ? parseInt(stbCh) : null,
          supertiebreakChallenged: stbCd ? parseInt(stbCd) : null,
          matchDate: new Date(matchDate).toISOString(),
          matchLocation: matchLocation || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to submit result')
        return
      }

      toast.success('Result submitted! The other team will be asked to verify.')
      router.push(`/challenges/${challengeId}`)
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (!challenge) return null

  const ScoreInput = ({
    label, chVal, cdVal, onChChange, onCdChange,
  }: {
    label: string
    chVal: string; cdVal: string
    onChChange: (v: string) => void; onCdChange: (v: string) => void
  }) => (
    <div>
      <p className="text-xs font-medium text-slate-400 mb-2">{label}</p>
      <div className="grid grid-cols-3 items-center gap-2">
        <div className="text-center">
          <p className="text-[10px] text-slate-500 mb-1 truncate">{challenge.challenging_team?.name}</p>
          <Input
            type="number"
            min="0"
            max="99"
            value={chVal}
            onChange={e => onChChange(e.target.value)}
            placeholder="0"
            className="bg-slate-900 border-slate-600 text-white text-center text-lg font-bold h-12"
          />
        </div>
        <div className="text-center text-slate-500 font-bold text-lg">–</div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 mb-1 truncate">{challenge.challenged_team?.name}</p>
          <Input
            type="number"
            min="0"
            max="99"
            value={cdVal}
            onChange={e => onCdChange(e.target.value)}
            placeholder="0"
            className="bg-slate-900 border-slate-600 text-white text-center text-lg font-bold h-12"
          />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">Report Result</h1>
          <p className="text-slate-400 text-sm">{challenge.challenge_code}</p>
        </div>
      </div>

      {/* Teams */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-4">
        <div className="flex items-center justify-between gap-4 text-center">
          <div className="flex-1">
            <p className="font-semibold text-white">{challenge.challenging_team?.name}</p>
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">Challenger</span>
          </div>
          <span className="text-slate-500 font-bold">vs</span>
          <div className="flex-1">
            <p className="font-semibold text-white">{challenge.challenged_team?.name}</p>
            <span className="text-[10px] bg-slate-500/20 text-slate-400 px-2 py-0.5 rounded-full border border-slate-500/30">Challenged</span>
          </div>
        </div>
      </Card>

      {/* Scores */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-6 space-y-6">
        <h2 className="font-semibold text-white">Match Scores</h2>

        <ScoreInput
          label="Set 1"
          chVal={set1Ch} cdVal={set1Cd}
          onChChange={setSet1Ch} onCdChange={setSet1Cd}
        />
        <ScoreInput
          label="Set 2"
          chVal={set2Ch} cdVal={set2Cd}
          onChChange={setSet2Ch} onCdChange={setSet2Cd}
        />

        {needsSupertiebreak && (
          <div className="border-t border-slate-700 pt-4">
            <ScoreInput
              label="Super Tiebreak (sets are 1-1)"
              chVal={stbCh} cdVal={stbCd}
              onChChange={setStbCh} onCdChange={setStbCd}
            />
          </div>
        )}

        {/* Winner preview */}
        {winnerLabel && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <Trophy className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <p className="text-emerald-300 text-sm font-medium">
              Winner: <span className="text-emerald-400">{winnerLabel}</span>
            </p>
          </div>
        )}
      </Card>

      {/* Match Details */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-6 space-y-4">
        <h2 className="font-semibold text-white">Match Details</h2>

        <div>
          <Label htmlFor="matchDate" className="text-slate-300 flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4" /> Date &amp; Time *
          </Label>
          <input
            id="matchDate"
            type="datetime-local"
            value={matchDate}
            onChange={e => setMatchDate(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <Label htmlFor="matchLocation" className="text-slate-300 flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4" /> Location (optional)
          </Label>
          <Input
            id="matchLocation"
            value={matchLocation}
            onChange={e => setMatchLocation(e.target.value)}
            placeholder="e.g. Chiniot Padel Club, Court 1"
            className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
          />
        </div>
      </Card>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-emerald-500 hover:bg-emerald-600 h-12 text-base font-semibold"
      >
        {submitting
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
          : <><Send className="h-4 w-4 mr-2" /> Submit Result</>
        }
      </Button>

      <p className="text-center text-slate-500 text-xs pb-4">
        The opposing team will have 24 hours to verify this result. If they don't respond, it will be auto-verified.
      </p>
    </div>
  )
}
