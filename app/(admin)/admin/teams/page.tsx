'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Team, Player, LadderPosition, Tier, Ticket, TicketType } from '@/types'
import { Plus, Trash2, Snowflake, Users, Ticket as TicketIcon, X, ChevronDown, AlertTriangle, ExternalLink, Upload, FileText, CheckCircle2, AlertCircle, Download, Copy, Check } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

interface TeamRow extends Omit<Team, 'player1' | 'player2' | 'ladder_position'> {
  player1?: { id: string; name: string; email: string }
  player2?: { id: string; name: string; email: string }
  ladder_position?: LadderPosition & { tier?: { id: string; name: string } }
}

interface TicketRow extends Ticket {
  team?: { id: string; name: string; player1?: { name: string }; player2?: { name: string } }
  assigner?: { id: string; name: string }
}

const TICKET_COLORS: Record<string, string> = {
  tier: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  silver: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
  gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
}

const TICKET_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  used: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
  forfeited: 'bg-red-500/20 text-red-300 border-red-500/40',
  converted: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
}

// Resolve status with fallback for pre-migration-005 rows (where status column doesn't exist yet)
function resolveTicketStatus(tk: TicketRow): string {
  if (tk.status) return tk.status
  return tk.is_used ? 'used' : 'active'
}

// Tier color map
const TIER_COLORS: Record<string, string> = {
  Diamond: 'border-cyan-500/50 bg-cyan-500/5',
  Platinum: 'border-violet-500/50 bg-violet-500/5',
  Gold: 'border-yellow-500/50 bg-yellow-500/5',
  Silver: 'border-slate-400/50 bg-slate-400/5',
  Bronze: 'border-orange-500/50 bg-orange-500/5',
}
const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
}

const TIERS_ORDER = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']

type TeamType = 'new' | 'returning'
type Placement = 'random' | 'specific'
type TicketOption = 'none' | 'tier' | 'silver' | 'gold'

export default function TeamsManagementPage() {
  const supabase = createClient()
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [seasonId, setSeasonId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [activeTab, setActiveTab] = useState('list')

  // Tickets state
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [ticketFilter, setTicketFilter] = useState<'all' | 'active' | 'used' | 'forfeited' | 'converted'>('all')
  const [ticketTeamFilter, setTicketTeamFilter] = useState('')
  const [assigningTicket, setAssigningTicket] = useState<string | null>(null) // teamId being assigned
  const [assignReason, setAssignReason] = useState('')
  const [ticketActionError, setTicketActionError] = useState('')

  // Form state
  const [teamName, setTeamName]         = useState('')
  const [player1Id, setPlayer1Id]       = useState('')
  const [player2Id, setPlayer2Id]       = useState('')
  const [teamType, setTeamType] = useState<TeamType>('new')
  const [selectedTier, setSelectedTier] = useState('Bronze')
  const [placement, setPlacement] = useState<Placement>('random')
  const [specificRank, setSpecificRank] = useState('1')
  const [returningRank, setReturningRank] = useState('1')
  const [ticketType, setTicketType] = useState<TicketOption>('none')
  const [entryFeePaid, setEntryFeePaid] = useState(false)

  // ── Bulk upload state ───────────────────────────────────────────────────
  type BulkRow = {
    teamName: string; player1Email: string; player2Email: string
    rank: string; ticket1: string; ticket2: string
    // validation errors (set in preview step)
    teamNameError?: string; p1Error?: string; p2Error?: string
    rankError?: string; ticket1Error?: string; ticket2Error?: string
  }
  type BulkResult = { index: number; teamName: string; success: boolean; error?: string; rank?: number }

  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkStep, setBulkStep] = useState<1 | 2 | 3 | 4>(1)
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([])
  const [bulkFileName, setBulkFileName] = useState('')
  const [bulkParseError, setBulkParseError] = useState('')
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 })
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([])
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: seasonData } = await supabase.from('seasons').select('id').eq('is_active', true).single()
    if (!seasonData) { setLoading(false); return }
    setSeasonId(seasonData.id)

    const [{ data: playersData }, { data: teamsData }, { data: tiersData }] = await Promise.all([
      supabase.from('players').select('*').eq('is_active', true),
      supabase.from('teams')
        .select('*, player1:players!player1_id(*), player2:players!player2_id(*), ladder_position:ladder_positions!team_id(*, tier:tiers!tier_id(*))')
        .eq('season_id', seasonData.id),
      supabase.from('tiers').select('*').eq('season_id', seasonData.id).order('rank_order', { ascending: true }),
    ])

    setPlayers(playersData || [])
    setTeams(teamsData || [])
    setTiers(tiersData || [])

    // Load tickets via admin API
    await loadTickets(seasonData.id)
    setLoading(false)
  }

  async function loadTickets(sid?: string) {
    const id = sid || seasonId
    if (!id) return
    const res = await fetch(`/api/admin/tickets?seasonId=${id}`)
    if (res.ok) {
      const data = await res.json()
      setTickets(data.tickets || [])
    }
  }

  function resetForm() {
    setTeamName(''); setPlayer1Id(''); setPlayer2Id('')
    setTeamType('new'); setSelectedTier('Bronze'); setPlacement('random')
    setSpecificRank('1'); setReturningRank('1'); setTicketType('none')
    setEntryFeePaid(false); setError('')
  }

  async function handleAddTeam() {
    setError('')
    if (!teamName || !player1Id || !player2Id) {
      setError('Please fill in all required fields'); return
    }
    if (!seasonId) { setError('No active season found — cannot create team'); return }

    const player1 = players.find(p => p.id === player1Id)
    const player2 = players.find(p => p.id === player2Id)
    if (!player1 || !player2) { setError('One or both players not found.'); return }
    if (player1.id === player2.id) { setError('Players must be different'); return }

    setSubmitting(true)
    try {
      const response = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName, player1Id: player1.id, player2Id: player2.id, seasonId,
          teamType, selectedTier, placement,
          specificRank: parseInt(specificRank),
          initialRank: parseInt(returningRank),
          ticketType: ticketType === 'none' ? null : ticketType,
          entryFeePaid,
        }),
      })
      const data = await response.json()
      if (!response.ok) { setError(data.error || `Server error (${response.status})`); return }
      setShowAddModal(false)
      resetForm()
      loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to create team: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFreezeTeam(teamId: string) {
    if (!confirm('Freeze this team? They will drop 1 position immediately.')) return
    await fetch(`/api/teams/${teamId}/freeze`, { method: 'POST' })
    loadData()
  }

  async function handleDissolveTeam(teamId: string) {
    if (!confirm('PERMANENTLY dissolve this team? This cannot be undone.')) return
    await fetch(`/api/teams/${teamId}/dissolve`, { method: 'POST' })
    loadData()
  }

  // ── Ticket helpers ──────────────────────────────────────────────────────
  async function handleAssignTicket(teamId: string, type: TicketType | 'late_entry') {
    setTicketActionError('')
    setAssigningTicket(teamId)
    try {
      const body = type === 'late_entry'
        ? { teamId, seasonId, lateEntry: true, assignedReason: assignReason || undefined }
        : { teamId, seasonId, ticketType: type, assignedReason: assignReason || undefined }

      const res = await fetch('/api/admin/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setTicketActionError(data.error || 'Failed to assign ticket'); return }
      setAssignReason('')
      await loadTickets()
    } catch (err) {
      setTicketActionError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAssigningTicket(null)
    }
  }

  async function handleRevokeTicket(ticketId: string) {
    if (!confirm('Revoke this ticket? It will be marked as forfeited.')) return
    setTicketActionError('')
    try {
      const res = await fetch('/api/admin/tickets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      })
      const data = await res.json()
      if (!res.ok) { setTicketActionError(data.error || 'Failed to revoke ticket'); return }
      await loadTickets()
    } catch (err) {
      setTicketActionError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  // ── Ladder view helpers ─────────────────────────────────────────────────
  // Rank is the source of truth. Tier is always derived from which range the rank falls in.
  function tierForRank(rank: number): Tier | null {
    return tiers.find(t => rank >= t.min_rank && rank <= (t.max_rank ?? t.min_rank)) ?? null
  }

  // Build a rank → team map, then group into tier sections by rank range
  const rankToTeam = new Map<number, TeamRow>()
  teams.forEach(t => {
    const pos = Array.isArray(t.ladder_position) ? t.ladder_position[0] : t.ladder_position
    if (pos?.rank) rankToTeam.set(pos.rank, t)
  })

  const tierSections = tiers.map(tier => {
    const slots: Array<{ rank: number; team: TeamRow | null }> = []
    for (let r = tier.min_rank; r <= (tier.max_rank ?? tier.min_rank); r++) {
      slots.push({ rank: r, team: rankToTeam.get(r) ?? null })
    }
    return { tier, slots }
  })

  // ── Ticket map: teamId → tickets (all statuses) ────────────────────────
  const ticketsByTeam = new Map<string, TicketRow[]>()
  tickets.forEach(tk => {
    const tid = (tk as any).team_id as string
    if (!tid) return
    if (!ticketsByTeam.has(tid)) ticketsByTeam.set(tid, [])
    ticketsByTeam.get(tid)!.push(tk)
  })

  function TicketBadges({ teamId }: { teamId: string }) {
    const tks = ticketsByTeam.get(teamId) ?? []
    if (tks.length === 0) return null
    return (
      <div className="flex items-center gap-1 flex-wrap mt-1">
        {tks.map(tk => {
          const st = resolveTicketStatus(tk)
          const active = st === 'active'
          const cls = active
            ? TICKET_COLORS[tk.ticket_type] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'
            : 'bg-slate-800/60 text-slate-500 border-slate-700/40 line-through'
          return (
            <span key={tk.id} className={`text-[10px] px-1.5 py-0.5 border rounded font-medium flex items-center gap-0.5 ${cls}`}>
              <TicketIcon className="h-2.5 w-2.5 shrink-0" />
              {tk.ticket_type.charAt(0).toUpperCase() + tk.ticket_type.slice(1)}
              {!active && <span className="text-[9px] opacity-70 ml-0.5">({st})</span>}
            </span>
          )
        })}
      </div>
    )
  }

  // ── Table view helpers ──────────────────────────────────────────────────
  const filteredTeams = teams.filter(team => {
    const pos = Array.isArray(team.ladder_position) ? team.ladder_position[0] : team.ladder_position
    const matchesSearch =
      team.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      team.player1?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      team.player2?.email?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = filterStatus === 'all' || team.status === filterStatus
    return matchesSearch && matchesStatus
  })

  // ── Bulk upload helpers ─────────────────────────────────────────────────
  const BULK_TEMPLATE = `team_name,player1_email,player2_email,rank,ticket_1,ticket_2\nEagles,john@example.com,jane@example.com,5,,\nWolves,mark@example.com,sara@example.com,8,silver,gold\nLions,alex@example.com,kim@example.com,12,tier,\n`

  function downloadTemplate() {
    const blob = new Blob([BULK_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'teams_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function parseCsv(text: string): BulkRow[] {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return []
    // Skip header row (first line)
    return lines.slice(1).map(line => {
      // Handle quoted values with commas inside
      const cols: string[] = []
      let current = ''; let inQuotes = false
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes }
        else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
        else { current += ch }
      }
      cols.push(current.trim())
      return {
        teamName: cols[0] ?? '',
        player1Email: cols[1] ?? '',
        player2Email: cols[2] ?? '',
        rank: cols[3] ?? '',
        ticket1: cols[4] ?? '',
        ticket2: cols[5] ?? '',
      }
    })
  }

  function handleBulkFile(file: File) {
    setBulkParseError('')
    if (!file.name.endsWith('.csv')) { setBulkParseError('Please upload a CSV file (.csv)'); return }
    setBulkFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const rows = parseCsv(text)
      if (rows.length === 0) { setBulkParseError('No data rows found. Make sure your CSV has a header row and at least one data row.'); return }
      const validated = validateBulkRows(rows)
      setBulkRows(validated)
    }
    reader.readAsText(file)
  }

  const VALID_TICKETS = new Set(['tier', 'silver', 'gold', ''])

  function validateBulkRows(rows: BulkRow[]): BulkRow[] {
    const ranksInCsv = new Map<string, number>() // rank → first row index
    return rows.map((row, i) => {
      const r = { ...row }
      r.teamNameError = !r.teamName.trim() ? 'Required' : undefined
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      r.p1Error = !r.player1Email.trim() ? 'Required'
        : !emailRe.test(r.player1Email) ? 'Invalid email'
        : undefined
      r.p2Error = !r.player2Email.trim() ? 'Required'
        : !emailRe.test(r.player2Email) ? 'Invalid email'
        : r.player2Email.toLowerCase() === r.player1Email.toLowerCase() ? 'Must differ from Player 1'
        : undefined
      const rankNum = parseInt(r.rank)
      if (!r.rank.trim() || isNaN(rankNum) || rankNum < 1) {
        r.rankError = 'Must be a positive number'
      } else if (ranksInCsv.has(r.rank.trim())) {
        r.rankError = `Duplicate rank in CSV (row ${(ranksInCsv.get(r.rank.trim()) ?? 0) + 2})`
      } else {
        ranksInCsv.set(r.rank.trim(), i)
        r.rankError = undefined
      }
      const t1 = r.ticket1.trim().toLowerCase()
      const t2 = r.ticket2.trim().toLowerCase()
      r.ticket1Error = t1 && !VALID_TICKETS.has(t1) ? 'Must be: tier, silver, gold, or empty' : undefined
      r.ticket2Error = t2 && !VALID_TICKETS.has(t2) ? 'Must be: tier, silver, gold, or empty'
        : (t1 && t2 && t1 === t2) ? 'Cannot be the same as Ticket 1'
        : undefined
      return r
    })
  }

  function hasRowErrors(row: BulkRow) {
    return !!(row.teamNameError || row.p1Error || row.p2Error || row.rankError || row.ticket1Error || row.ticket2Error)
  }

  async function runBulkUpload() {
    const validRows = bulkRows.filter(r => !hasRowErrors(r))
    if (validRows.length === 0) return
    setBulkSubmitting(true)
    setBulkProgress({ current: 0, total: validRows.length })
    setBulkStep(3)

    const payload = validRows.map(r => ({
      teamName: r.teamName.trim(),
      player1Email: r.player1Email.trim().toLowerCase(),
      player2Email: r.player2Email.trim().toLowerCase(),
      rank: parseInt(r.rank),
      ticket1: r.ticket1.trim().toLowerCase() || null,
      ticket2: r.ticket2.trim().toLowerCase() || null,
    }))

    try {
      const res = await fetch('/api/admin/teams/bulk-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload, seasonId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBulkResults([{ index: 0, teamName: 'Upload Error', success: false, error: data.error || 'Server error' }])
      } else {
        setBulkResults(data.results || [])
        setBulkProgress({ current: validRows.length, total: validRows.length })
        loadData()
      }
    } catch (err) {
      setBulkResults([{ index: 0, teamName: 'Network Error', success: false, error: err instanceof Error ? err.message : 'Network error' }])
    } finally {
      setBulkSubmitting(false)
      setBulkStep(4)
    }
  }

  function resetBulkModal() {
    setBulkStep(1); setBulkRows([]); setBulkFileName(''); setBulkParseError('')
    setBulkProgress({ current: 0, total: 0 }); setBulkResults([]); setBulkSubmitting(false); setCopiedAll(false)
  }

  function copyAllResults() {
    const lines = bulkResults.map(r =>
      r.success ? `✓ ${r.teamName} — Rank #${r.rank}` : `✗ ${r.teamName} — ${r.error}`
    ).join('\n')
    navigator.clipboard.writeText(lines)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const BulkUploadModal = (
    <Dialog open={showBulkModal} onOpenChange={open => { setShowBulkModal(open); if (!open) resetBulkModal() }}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-emerald-400" />
            Bulk Upload Teams
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Create multiple teams at once from a CSV file
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 my-2">
          {([1,2,3,4] as const).map((s, idx) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${
                bulkStep > s ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                : bulkStep === s ? 'border-emerald-500 text-emerald-400'
                : 'border-slate-600 text-slate-600'}`}>
                {bulkStep > s ? <Check className="h-3 w-3" /> : s}
              </div>
              {idx < 3 && <div className={`h-px w-8 ${bulkStep > s ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
            </div>
          ))}
          <span className="text-xs text-slate-400 ml-2">
            {bulkStep === 1 ? 'Upload CSV' : bulkStep === 2 ? 'Preview & Validate' : bulkStep === 3 ? 'Processing' : 'Results'}
          </span>
        </div>

        {/* ── Step 1: Upload ── */}
        {bulkStep === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-300">Download the template, fill it in, then upload it below.</p>
              <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 gap-2" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5" />Template
              </Button>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3 text-xs font-mono text-slate-400 border border-slate-700">
              <p className="text-slate-300 font-semibold mb-1">CSV Columns:</p>
              <p>team_name · player1_email · player2_email · rank · ticket_1 · ticket_2</p>
              <p className="mt-1 text-slate-500">ticket_1 / ticket_2: tier | silver | gold | (empty = no ticket)</p>
              <p className="text-slate-500">rank: absolute ladder position (e.g. 5 = 5th overall) · tickets must differ if both provided</p>
            </div>

            <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-emerald-500/60 hover:bg-emerald-500/5 transition-colors">
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <FileText className="h-8 w-8" />
                <span className="text-sm font-medium">Click to upload CSV</span>
                <span className="text-xs">{bulkFileName || 'No file selected'}</span>
              </div>
              <input type="file" accept=".csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBulkFile(f) }} />
            </label>

            {bulkParseError && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded p-2">{bulkParseError}</p>
            )}

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={bulkRows.length === 0}
              onClick={() => setBulkStep(2)}
            >
              Preview {bulkRows.length > 0 ? `(${bulkRows.length} rows)` : ''}
            </Button>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {bulkStep === 2 && (
          <div className="space-y-4">
            {(() => {
              const validCount = bulkRows.filter(r => !hasRowErrors(r)).length
              const invalidCount = bulkRows.length - validCount
              return (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />{validCount} valid
                  </span>
                  {invalidCount > 0 && (
                    <span className="text-sm text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />{invalidCount} with errors (will be skipped)
                    </span>
                  )}
                </div>
              )
            })()}

            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-700 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/70 sticky top-0">
                  <tr>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">#</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Team Name</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Player 1 Email</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Player 2 Email</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Rank</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Ticket 1</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Ticket 2</th>
                    <th className="text-left text-slate-400 px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((row, i) => {
                    const hasError = hasRowErrors(row)
                    return (
                      <tr key={i} className={`border-t border-slate-800 ${hasError ? 'bg-red-500/5' : 'hover:bg-slate-800/40'}`}>
                        <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <span className={row.teamNameError ? 'text-red-400' : 'text-white'}>{row.teamName || '—'}</span>
                          {row.teamNameError && <p className="text-[10px] text-red-400">{row.teamNameError}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={row.p1Error ? 'text-red-400' : 'text-slate-300'}>{row.player1Email || '—'}</span>
                          {row.p1Error && <p className="text-[10px] text-red-400">{row.p1Error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={row.p2Error ? 'text-red-400' : 'text-slate-300'}>{row.player2Email || '—'}</span>
                          {row.p2Error && <p className="text-[10px] text-red-400">{row.p2Error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={row.rankError ? 'text-red-400' : 'text-slate-300'}>{row.rank || '—'}</span>
                          {row.rankError && <p className="text-[10px] text-red-400">{row.rankError}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={row.ticket1Error ? 'text-red-400' : 'text-slate-400'}>{row.ticket1 || '—'}</span>
                          {row.ticket1Error && <p className="text-[10px] text-red-400">{row.ticket1Error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={row.ticket2Error ? 'text-red-400' : 'text-slate-400'}>{row.ticket2 || '—'}</span>
                          {row.ticket2Error && <p className="text-[10px] text-red-400">{row.ticket2Error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          {hasError
                            ? <span className="text-red-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" />Skip</span>
                            : <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />OK</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {bulkRows.filter(r => !hasRowErrors(r)).length === 0 && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded p-2">
                All rows have errors. Please fix the CSV and re-upload.
              </p>
            )}

            <p className="text-xs text-slate-500">
              Server will also validate: player emails exist, ranks not occupied, ranks within a tier, players under team limit.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="border-slate-600 text-slate-300 flex-1" onClick={() => setBulkStep(1)}>
                Back
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 flex-1"
                disabled={bulkRows.filter(r => !hasRowErrors(r)).length === 0}
                onClick={runBulkUpload}
              >
                Upload {bulkRows.filter(r => !hasRowErrors(r)).length} Teams
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Processing ── */}
        {bulkStep === 3 && (
          <div className="space-y-6 py-4 text-center">
            <div className="flex items-center justify-center">
              <div className="animate-spin h-10 w-10 border-4 border-emerald-500 border-t-transparent rounded-full" />
            </div>
            <div>
              <p className="text-white font-medium">Creating teams…</p>
              <p className="text-slate-400 text-sm mt-1">
                {bulkProgress.current} / {bulkProgress.total} complete
              </p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                style={{ width: bulkProgress.total > 0 ? `${(bulkProgress.current / bulkProgress.total) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-xs text-slate-500">Please wait — this may take a moment</p>
          </div>
        )}

        {/* ── Step 4: Results ── */}
        {bulkStep === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />{bulkResults.filter(r => r.success).length} created
              </span>
              {bulkResults.filter(r => !r.success).length > 0 && (
                <span className="text-sm text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />{bulkResults.filter(r => !r.success).length} failed
                </span>
              )}
              <Button size="sm" variant="ghost" className="ml-auto text-slate-400 gap-1 text-xs" onClick={copyAllResults}>
                {copiedAll ? <><Check className="h-3 w-3" />Copied!</> : <><Copy className="h-3 w-3" />Copy Results</>}
              </Button>
            </div>

            <div className="max-h-64 overflow-y-auto border border-slate-700 rounded-lg divide-y divide-slate-800">
              {bulkResults.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 px-3 py-2 ${r.success ? 'hover:bg-slate-800/30' : 'bg-red-500/5'}`}>
                  {r.success
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    : <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${r.success ? 'text-white' : 'text-red-300'}`}>{r.teamName}</p>
                    <p className="text-xs text-slate-400">
                      {r.success ? `Created at rank #${r.rank}` : r.error}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => { setShowBulkModal(false); resetBulkModal() }}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  const AddTeamButton = (
    <Dialog open={showAddModal} onOpenChange={(open) => { setShowAddModal(open); if (!open) resetForm() }}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4 mr-2" />Add Team
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Create New Team</DialogTitle>
          <DialogDescription className="text-slate-400">Add a new team to the current season</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded p-2">{error}</p>}

          <div>
            <Label className="text-slate-300">Team Name</Label>
            <Input placeholder="e.g., Power Duo" value={teamName}
              onChange={e => setTeamName(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white mt-2" />
          </div>

          <div>
            <Label className="text-slate-300">Player 1</Label>
            <Select value={player1Id} onValueChange={setPlayer1Id}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                <SelectValue placeholder="Select player 1" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-52">
                {players.filter(p => p.id !== player2Id).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-slate-300">Player 2</Label>
            <Select value={player2Id} onValueChange={setPlayer2Id}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                <SelectValue placeholder="Select player 2" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 max-h-52">
                {players.filter(p => p.id !== player1Id).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-slate-500">
            Players must be created first in the <a href="/admin/players" className="text-emerald-400 hover:text-emerald-300">Players</a> section before they can be added to a team.
          </p>

          <div>
            <Label className="text-slate-300">Team Type</Label>
            <Select value={teamType} onValueChange={v => setTeamType(v as TeamType)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="new">New Team</SelectItem>
                <SelectItem value="returning">Returning Team</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {teamType === 'new' && (
            <>
              <div>
                <Label className="text-slate-300">Starting Tier</Label>
                <Select value={selectedTier} onValueChange={setSelectedTier}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {tiers.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Placement within Tier</Label>
                <Select value={placement} onValueChange={v => setPlacement(v as Placement)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="random">Random (bottom of tier)</SelectItem>
                    <SelectItem value="specific">Specific spot</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {placement === 'specific' && (
                <div>
                  <Label className="text-slate-300">Rank within {selectedTier} tier (1 = top of tier)</Label>
                  <Input type="number" min="1" value={specificRank}
                    onChange={e => setSpecificRank(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white mt-2" />
                  <p className="text-xs text-slate-500 mt-1">Teams below this rank will shift down by 1.</p>
                </div>
              )}
            </>
          )}

          {teamType === 'returning' && (
            <div>
              <Label className="text-slate-300">Initial Rank (overall ladder position)</Label>
              <Input type="number" min="1" value={returningRank}
                onChange={e => setReturningRank(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white mt-2" />
            </div>
          )}

          <div>
            <Label className="text-slate-300">Ticket</Label>
            <Select value={ticketType} onValueChange={v => setTicketType(v as TicketOption)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="none">No Ticket</SelectItem>
                <SelectItem value="tier">Tier Ticket</SelectItem>
                <SelectItem value="silver">Silver Ticket</SelectItem>
                <SelectItem value="gold">Gold Ticket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="entryFee" checked={entryFeePaid}
              onChange={e => setEntryFeePaid(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
            <Label htmlFor="entryFee" className="text-slate-300">Entry Fee Paid</Label>
          </div>

          <Button onClick={handleAddTeam} disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700">
            {submitting ? 'Creating...' : 'Create Team'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-slate-400">Loading...</div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Teams</h1>
          <p className="text-slate-400 mt-1 text-sm">{teams.filter(t => t.status !== 'dissolved').length} active teams · <a href="/admin/ladder" className="text-emerald-400 hover:text-emerald-300">View Ladder →</a></p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 gap-2"
            onClick={() => { resetBulkModal(); setShowBulkModal(true) }}>
            <Upload className="w-4 h-4" />Bulk Upload
          </Button>
          {AddTeamButton}
        </div>
      </div>
      {BulkUploadModal}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="list">
            <Users className="w-4 h-4 mr-2" />Team List
          </TabsTrigger>
          <TabsTrigger value="tickets">
            <TicketIcon className="w-4 h-4 mr-2" />Tickets
          </TabsTrigger>
        </TabsList>

        {/* ── (Ladder View and Rank Adjust moved to /admin/ladder) ── */}
        {/* ── Team List Tab ───────────────────────────────────── */}

        {/* ── Team List Tab ───────────────────────────────────── */}
        <TabsContent value="list" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="flex gap-4 flex-wrap">
            <Input placeholder="Search teams, players..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white w-full md:w-72" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-full md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="frozen">Frozen</SelectItem>
                <SelectItem value="dissolved">Dissolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-900/50 border-slate-700">
                  <TableRow>
                    <TableHead className="text-slate-300">Rank</TableHead>
                    <TableHead className="text-slate-300">Team Name</TableHead>
                    <TableHead className="text-slate-300">Player 1</TableHead>
                    <TableHead className="text-slate-300">Player 2</TableHead>
                    <TableHead className="text-slate-300">Tier</TableHead>
                    <TableHead className="text-slate-300">Tickets</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-300 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeams
                    .slice()
                    .sort((a, b) => {
                      const aPos = Array.isArray(a.ladder_position) ? a.ladder_position[0] : a.ladder_position
                      const bPos = Array.isArray(b.ladder_position) ? b.ladder_position[0] : b.ladder_position
                      return (aPos?.rank ?? 9999) - (bPos?.rank ?? 9999)
                    })
                    .map(team => {
                      const pos = Array.isArray(team.ladder_position) ? team.ladder_position[0] : team.ladder_position
                      return (
                        <TableRow key={team.id} className="border-slate-700">
                          <TableCell className="text-slate-400 font-mono">
                            {pos?.rank ? `#${pos.rank}` : '—'}
                          </TableCell>
                          <TableCell>
                            <Link href={`/admin/teams/${team.id}`} className="font-medium text-white hover:text-emerald-300 flex items-center gap-1 group">
                              {team.name}
                              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-300">{team.player1?.name}</TableCell>
                          <TableCell className="text-slate-300">{team.player2?.name}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-1 rounded border font-medium ${TIER_BADGE[tierForRank(pos?.rank ?? 0)?.name ?? ''] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                              {tierForRank(pos?.rank ?? 0)?.name ?? 'N/A'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {(ticketsByTeam.get(team.id) ?? []).length > 0 ? (
                                (ticketsByTeam.get(team.id) ?? []).map(tk => {
                                  const st = resolveTicketStatus(tk)
                                  const active = st === 'active'
                                  const cls = active
                                    ? TICKET_COLORS[tk.ticket_type] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'
                                    : 'bg-slate-800 text-slate-500 border-slate-700/40'
                                  return (
                                    <span key={tk.id} className={`text-xs px-2 py-0.5 border rounded font-medium flex items-center gap-1 w-fit ${cls}`}>
                                      <TicketIcon className="h-3 w-3 shrink-0" />
                                      {tk.ticket_type.charAt(0).toUpperCase() + tk.ticket_type.slice(1)}
                                      {!active && <span className="opacity-60 text-[10px]">({st})</span>}
                                    </span>
                                  )
                                })
                              ) : (
                                <span className="text-slate-600 text-xs">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={team.status === 'active' ? 'default' : team.status === 'frozen' ? 'secondary' : 'destructive'}>
                              {team.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            {team.status === 'active' && (
                              <Button size="sm" variant="ghost" onClick={() => handleFreezeTeam(team.id)}
                                className="text-blue-400 hover:bg-blue-400/10">
                                <Snowflake className="w-4 h-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => handleDissolveTeam(team.id)}
                              className="text-red-400 hover:bg-red-400/10">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </div>
          </Card>

          {filteredTeams.length === 0 && (
            <Card className="bg-slate-800/60 border-slate-700 p-12 text-center">
              <div className="text-slate-400">No teams found matching your criteria</div>
            </Card>
          )}
        </TabsContent>

        {/* ── Tickets Tab ─────────────────────────────────────── */}
        <TabsContent value="tickets" className="space-y-6 mt-4">

          {/* Error banner */}
          {ticketActionError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {ticketActionError}
              <button onClick={() => setTicketActionError('')} className="ml-auto text-red-400 hover:text-red-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Section 1: Per-team assignment ───────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Assign Tickets to Teams</h2>
                <p className="text-sm text-slate-400 mt-0.5">Late entry teams should receive both Silver and Gold tickets.</p>
              </div>
              <Input
                placeholder="Search teams…"
                value={ticketTeamFilter}
                onChange={e => setTicketTeamFilter(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white w-56"
              />
            </div>

            <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow>
                    <TableHead className="text-slate-300">Rank</TableHead>
                    <TableHead className="text-slate-300">Team</TableHead>
                    <TableHead className="text-slate-300">Tier</TableHead>
                    <TableHead className="text-slate-300">Active Tickets</TableHead>
                    <TableHead className="text-slate-300 text-right">Assign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams
                    .filter(t => t.status !== 'dissolved')
                    .filter(t =>
                      !ticketTeamFilter ||
                      t.name.toLowerCase().includes(ticketTeamFilter.toLowerCase()) ||
                      t.player1?.name?.toLowerCase().includes(ticketTeamFilter.toLowerCase()) ||
                      t.player2?.name?.toLowerCase().includes(ticketTeamFilter.toLowerCase())
                    )
                    .slice()
                    .sort((a, b) => {
                      const aPos = Array.isArray(a.ladder_position) ? a.ladder_position[0] : a.ladder_position
                      const bPos = Array.isArray(b.ladder_position) ? b.ladder_position[0] : b.ladder_position
                      return (aPos?.rank ?? 9999) - (bPos?.rank ?? 9999)
                    })
                    .map(team => {
                      const pos = Array.isArray(team.ladder_position) ? team.ladder_position[0] : team.ladder_position
                      const teamActiveTickets = tickets.filter(tk => tk.team_id === team.id && resolveTicketStatus(tk) === 'active')
                      const hasSilver = teamActiveTickets.some(tk => tk.ticket_type === 'silver')
                      const hasGold = teamActiveTickets.some(tk => tk.ticket_type === 'gold')
                      const hasTier = teamActiveTickets.some(tk => tk.ticket_type === 'tier')
                      const isAssigning = assigningTicket === team.id

                      return (
                        <TableRow key={team.id} className="border-slate-700">
                          <TableCell className="text-slate-400 font-mono text-sm">
                            {pos?.rank ? `#${pos.rank}` : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-white">{team.name}</div>
                            <div className="text-xs text-slate-400">{team.player1?.name} & {team.player2?.name}</div>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-1 rounded border font-medium ${TIER_BADGE[tierForRank(pos?.rank ?? 0)?.name ?? ''] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                              {tierForRank(pos?.rank ?? 0)?.name ?? 'N/A'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {teamActiveTickets.length === 0 ? (
                                <span className="text-xs text-slate-600 italic">No active tickets</span>
                              ) : (
                                teamActiveTickets.map(tk => (
                                  <div key={tk.id} className="flex items-center gap-1">
                                    <span className={`text-xs px-2 py-0.5 rounded border font-medium capitalize ${TICKET_COLORS[tk.ticket_type] ?? ''}`}>
                                      {tk.ticket_type}
                                    </span>
                                    <button
                                      onClick={() => handleRevokeTicket(tk.id)}
                                      title="Revoke ticket"
                                      className="text-slate-500 hover:text-red-400 transition-colors"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isAssigning}
                                  className="border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 h-8"
                                >
                                  {isAssigning ? 'Assigning…' : 'Assign'}
                                  <ChevronDown className="w-3.5 h-3.5 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="bg-slate-800 border-slate-700">
                                <DropdownMenuItem
                                  onClick={() => handleAssignTicket(team.id, 'tier')}
                                  disabled={hasTier}
                                  className="text-violet-300 focus:text-violet-200 focus:bg-violet-500/10 cursor-pointer"
                                >
                                  <TicketIcon className="w-3.5 h-3.5 mr-2" />
                                  Tier Ticket
                                  {hasTier && <span className="ml-auto text-xs text-slate-500">(has one)</span>}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleAssignTicket(team.id, 'silver')}
                                  disabled={hasSilver}
                                  className="text-slate-200 focus:text-white focus:bg-slate-500/10 cursor-pointer"
                                >
                                  <TicketIcon className="w-3.5 h-3.5 mr-2" />
                                  Silver Ticket
                                  {hasSilver && <span className="ml-auto text-xs text-slate-500">(has one)</span>}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleAssignTicket(team.id, 'gold')}
                                  disabled={hasGold}
                                  className="text-yellow-300 focus:text-yellow-200 focus:bg-yellow-500/10 cursor-pointer"
                                >
                                  <TicketIcon className="w-3.5 h-3.5 mr-2" />
                                  Gold Ticket
                                  {hasGold && <span className="ml-auto text-xs text-slate-500">(has one)</span>}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-slate-700" />
                                <DropdownMenuItem
                                  onClick={() => handleAssignTicket(team.id, 'late_entry')}
                                  disabled={hasSilver || hasGold}
                                  className="text-amber-300 focus:text-amber-200 focus:bg-amber-500/10 cursor-pointer"
                                >
                                  <TicketIcon className="w-3.5 h-3.5 mr-2" />
                                  Late Entry (Silver + Gold)
                                  {(hasSilver || hasGold) && <span className="ml-auto text-xs text-slate-500">(already has)</span>}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* ── Section 2: Ticket history ─────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">All Tickets This Season</h2>
              <div className="flex items-center gap-2">
                <Select value={ticketFilter} onValueChange={v => setTicketFilter(v as typeof ticketFilter)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="used">Used</SelectItem>
                    <SelectItem value="forfeited">Forfeited</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow>
                    <TableHead className="text-slate-300">Team</TableHead>
                    <TableHead className="text-slate-300">Type</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-300">Assigned By</TableHead>
                    <TableHead className="text-slate-300">Reason</TableHead>
                    <TableHead className="text-slate-300">Date</TableHead>
                    <TableHead className="text-slate-300 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets
                    .filter(tk => ticketFilter === 'all' || resolveTicketStatus(tk) === ticketFilter)
                    .map(tk => (
                      <TableRow key={tk.id} className="border-slate-700">
                        <TableCell>
                          <div className="font-medium text-white">{tk.team?.name ?? '—'}</div>
                          <div className="text-xs text-slate-400">
                            {tk.team?.player1?.name} & {tk.team?.player2?.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-1 rounded border font-medium capitalize ${TICKET_COLORS[tk.ticket_type] ?? ''}`}>
                            {tk.ticket_type}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-1 rounded border font-medium capitalize ${TICKET_STATUS_COLORS[resolveTicketStatus(tk)] ?? ''}`}>
                            {resolveTicketStatus(tk)}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {tk.assigner?.name ?? <span className="text-slate-600 italic">System</span>}
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm max-w-[200px] truncate">
                          {tk.assigned_reason ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm">
                          {(() => { const d = new Date(tk.created_at); const wd = d.toLocaleDateString('en-GB', { weekday: 'short' }); return `${wd} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })()}
                        </TableCell>
                        <TableCell className="text-right">
                          {resolveTicketStatus(tk) === 'active' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRevokeTicket(tk.id)}
                              className="text-red-400 hover:bg-red-400/10 h-7 px-2 text-xs"
                            >
                              Revoke
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-600 italic">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  {tickets.filter(tk => ticketFilter === 'all' || resolveTicketStatus(tk) === ticketFilter).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 py-8 italic">
                        No tickets found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  )
}
