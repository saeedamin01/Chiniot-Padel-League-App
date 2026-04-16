'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Player } from '@/types'
import {
  Shield, Mail, Lock, CheckCircle, ExternalLink, KeyRound,
  Plus, Loader2, Copy, Users, Upload, Download, AlertCircle,
  CheckCircle2, XCircle, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerRow extends Player {
  phone?: string
  teams: { id: string; name: string; status: string }[]
}

interface BulkRow {
  name: string
  email: string
  phone: string
  // validation
  nameError?: string
  emailError?: string
}

interface BulkResult {
  name: string
  email: string
  success: boolean
  tempPassword?: string
  emailSent?: boolean
  error?: string
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const CSV_TEMPLATE = `name,email,phone\nAhmed Khan,ahmed@example.com,+92 300 1234567\nSara Ali,sara@example.com,`

function parseCSV(text: string): BulkRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Normalise headers
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase())
  const nameIdx  = headers.indexOf('name')
  const emailIdx = headers.indexOf('email')
  const phoneIdx = headers.indexOf('phone')

  if (nameIdx === -1 || emailIdx === -1) return []

  return lines.slice(1).map(line => {
    // Simple split — handles the common case; quoted commas not expected in our template
    const cols = line.split(',').map(v => v.replace(/"/g, '').trim())
    return {
      name:  cols[nameIdx]  ?? '',
      email: cols[emailIdx] ?? '',
      phone: phoneIdx !== -1 ? (cols[phoneIdx] ?? '') : '',
    }
  }).filter(r => r.name || r.email) // skip completely blank rows
}

function validateRows(rows: BulkRow[]): BulkRow[] {
  const seen = new Set<string>()
  return rows.map(r => {
    const out = { ...r, nameError: undefined as string | undefined, emailError: undefined as string | undefined }
    if (!r.name.trim())         out.nameError  = 'Required'
    if (!r.email.trim())        out.emailError = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) out.emailError = 'Invalid email'
    else if (seen.has(r.email.toLowerCase())) out.emailError = 'Duplicate in file'
    else seen.add(r.email.toLowerCase())
    return out
  })
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'cpl_players_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlayersPage() {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [players, setPlayers]           = useState<PlayerRow[]>([])
  const [loading, setLoading]           = useState(true)
  const [searchTerm, setSearchTerm]     = useState('')
  const [filterAdmin, setFilterAdmin]   = useState('all')
  const [filterActive, setFilterActive] = useState('all')

  // ── Add single player modal ───────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName]           = useState('')
  const [addEmail, setAddEmail]         = useState('')
  const [addPhone, setAddPhone]         = useState('')
  const [addLoading, setAddLoading]     = useState(false)
  const [addError, setAddError]         = useState('')
  const [newCreds, setNewCreds]         = useState<BulkResult | null>(null)

  // ── Bulk upload modal ─────────────────────────────────────────────────────
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkStep, setBulkStep]           = useState<'upload' | 'preview' | 'processing' | 'results'>('upload')
  const [bulkRows, setBulkRows]           = useState<BulkRow[]>([])
  const [bulkProgress, setBulkProgress]   = useState({ current: 0, total: 0 })
  const [bulkCurrentName, setBulkCurrentName] = useState('')
  const [bulkResults, setBulkResults]     = useState<BulkResult[]>([])

  // ── Data loading ──────────────────────────────────────────────────────────
  useEffect(() => { loadPlayers() }, [])

  async function loadPlayers() {
    try {
      setLoading(true)
      const { data: playersData } = await supabase.from('players').select('*').order('name', { ascending: true })
      if (!playersData) { setLoading(false); return }

      const { data: teamsData } = await supabase
        .from('teams').select('id, name, status, player1_id, player2_id').neq('status', 'dissolved')

      const teamsByPlayer = new Map<string, { id: string; name: string; status: string }[]>()
      for (const t of (teamsData || [])) {
        for (const pid of [t.player1_id, t.player2_id]) {
          if (!pid) continue
          if (!teamsByPlayer.has(pid)) teamsByPlayer.set(pid, [])
          teamsByPlayer.get(pid)!.push({ id: t.id, name: t.name, status: t.status })
        }
      }
      setPlayers(playersData.map(p => ({ ...p, teams: teamsByPlayer.get(p.id) ?? [] })))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // ── Single player creation ────────────────────────────────────────────────
  function resetAddForm() { setAddName(''); setAddEmail(''); setAddPhone(''); setAddError(''); setNewCreds(null) }

  async function handleAddPlayer() {
    setAddError('')
    if (!addName.trim() || !addEmail.trim()) { setAddError('Name and email are required'); return }
    setAddLoading(true)
    try {
      const res  = await fetch('/api/admin/players/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), email: addEmail.trim(), phone: addPhone.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setAddError(data.error || 'Failed to create player'); return }
      setNewCreds({ success: true, name: data.player.name, email: data.player.email, tempPassword: data.tempPassword, emailSent: data.emailSent })
      loadPlayers()
    } catch { setAddError('Something went wrong') }
    finally { setAddLoading(false) }
  }

  // ── Bulk upload ───────────────────────────────────────────────────────────
  function resetBulk() { setBulkStep('upload'); setBulkRows([]); setBulkProgress({ current: 0, total: 0 }); setBulkResults([]); setBulkCurrentName('') }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      if (parsed.length === 0) {
        toast.error('No valid rows found. Make sure the CSV has name and email columns.')
        return
      }
      setBulkRows(validateRows(parsed))
      setBulkStep('preview')
    }
    reader.readAsText(file)
    // Reset so the same file can be re-uploaded
    e.target.value = ''
  }

  async function runBulkCreate() {
    const valid = bulkRows.filter(r => !r.nameError && !r.emailError)
    setBulkStep('processing')
    setBulkProgress({ current: 0, total: valid.length })

    const results: BulkResult[] = []
    // 1.5s between requests to avoid SMTP rate limits
    const SMTP_DELAY_MS = 1500

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i]
      setBulkProgress({ current: i + 1, total: valid.length })
      setBulkCurrentName(row.name)

      try {
        const res  = await fetch('/api/admin/players/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: row.name, email: row.email, phone: row.phone || undefined }),
        })
        const data = await res.json()
        if (!res.ok) {
          results.push({ success: false, name: row.name, email: row.email, error: data.error || 'Unknown error' })
        } else {
          results.push({ success: true, name: data.player.name, email: data.player.email, tempPassword: data.tempPassword, emailSent: data.emailSent })
        }
      } catch (err) {
        results.push({ success: false, name: row.name, email: row.email, error: 'Network error' })
      }

      // Wait between requests — skip delay after the last one
      if (i < valid.length - 1) {
        await new Promise(r => setTimeout(r, SMTP_DELAY_MS))
      }
    }

    setBulkResults(results)
    setBulkStep('results')
    loadPlayers()
  }

  function copyAllPasswords() {
    const lines = bulkResults
      .filter(r => r.success && r.tempPassword)
      .map(r => `${r.name} | ${r.email} | ${r.tempPassword}`)
      .join('\n')
    navigator.clipboard.writeText(lines)
    toast.success('All credentials copied to clipboard')
  }

  // ── Existing player actions ───────────────────────────────────────────────
  async function handleMakeAdmin(id: string)   { await supabase.from('players').update({ is_admin: true  }).eq('id', id); loadPlayers() }
  async function handleRemoveAdmin(id: string) {
    if (!confirm('Remove admin privileges?')) return
    await supabase.from('players').update({ is_admin: false }).eq('id', id); loadPlayers()
  }
  async function handleResendVerification(id: string, email: string) {
    const res = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: id, email }) })
    toast[res.ok ? 'success' : 'error'](res.ok ? 'Verification email sent' : 'Failed to resend')
  }
  async function handleResetPassword(id: string, email: string) {
    if (!confirm(`Send a password reset email to ${email}?`)) return
    const res  = await fetch(`/api/admin/players/${id}/reset-password`, { method: 'POST' })
    const data = await res.json()
    toast[res.ok ? 'success' : 'error'](res.ok ? `Password reset sent to ${email}` : (data.error || 'Failed'))
  }
  async function handleSuspend(id: string)   { if (!confirm('Suspend this account?')) return; await supabase.from('players').update({ is_active: false }).eq('id', id); loadPlayers() }
  async function handleUnsuspend(id: string) { await supabase.from('players').update({ is_active: true  }).eq('id', id); loadPlayers() }

  const filtered = players.filter(p => {
    const q = searchTerm.toLowerCase()
    return (
      (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (p.phone || '').includes(q)) &&
      (filterAdmin  === 'all' || (filterAdmin  === 'admin'    && p.is_admin)  || (filterAdmin  === 'regular'  && !p.is_admin)) &&
      (filterActive === 'all' || (filterActive === 'active'   && p.is_active) || (filterActive === 'inactive' && !p.is_active))
    )
  })

  const validBulkCount   = bulkRows.filter(r => !r.nameError && !r.emailError).length
  const invalidBulkCount = bulkRows.length - validBulkCount

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-slate-400">Loading players...</div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Players</h1>
          <p className="text-slate-400 mt-1 text-sm">{players.length} players registered</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800"
            onClick={() => { resetBulk(); setShowBulkModal(true) }}>
            <Upload className="w-4 h-4 mr-2" />Bulk Upload
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => { resetAddForm(); setShowAddModal(true) }}>
            <Plus className="w-4 h-4 mr-2" />Add Player
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <Input placeholder="Search name, email or phone…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white w-full md:w-72" />
        <select value={filterAdmin} onChange={e => setFilterAdmin(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-2">
          <option value="all">All Roles</option>
          <option value="admin">Admins Only</option>
          <option value="regular">Regular Players</option>
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-2">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900/50 border-slate-700">
              <TableRow>
                <TableHead className="text-slate-300">Name</TableHead>
                <TableHead className="text-slate-300">Email</TableHead>
                <TableHead className="text-slate-300">Phone</TableHead>
                <TableHead className="text-slate-300">Teams</TableHead>
                <TableHead className="text-slate-300">Verified</TableHead>
                <TableHead className="text-slate-300">Role</TableHead>
                <TableHead className="text-slate-300">Status</TableHead>
                <TableHead className="text-slate-300 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(player => (
                <TableRow key={player.id} className="border-slate-700">
                  <TableCell>
                    <Link href={`/admin/players/${player.id}`} className="font-medium text-white hover:text-emerald-300 flex items-center gap-1 group">
                      {player.name}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm">{player.email}</TableCell>
                  <TableCell className="text-slate-400 text-sm">{player.phone || <span className="text-slate-600">—</span>}</TableCell>
                  <TableCell>
                    {player.teams.length === 0 ? (
                      <span className="text-slate-600 text-xs italic">No teams</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {player.teams.map(t => (
                          <Link key={t.id} href={`/admin/teams/${t.id}`}
                            className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-emerald-300 transition-colors">
                            <Users className="h-3 w-3 shrink-0" />{t.name}
                            {t.status === 'frozen' && <span className="text-blue-400 text-[10px]">(frozen)</span>}
                          </Link>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {player.email_verified
                      ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Verified</Badge>
                      : <Badge variant="secondary">Unverified</Badge>}
                  </TableCell>
                  <TableCell>
                    {player.is_admin
                      ? <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30"><Shield className="w-3 h-3 mr-1" />Admin</Badge>
                      : <Badge variant="outline">Player</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={player.is_active ? 'default' : 'destructive'}>
                      {player.is_active ? 'Active' : 'Suspended'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {!player.email_verified && (
                        <Button size="sm" variant="ghost" onClick={() => handleResendVerification(player.id, player.email)}
                          className="text-blue-400 hover:bg-blue-400/10 h-7 w-7 p-0" title="Resend verification email">
                          <Mail className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleResetPassword(player.id, player.email)}
                        className="text-amber-400 hover:bg-amber-400/10 h-7 w-7 p-0" title="Send password reset">
                        <KeyRound className="w-3.5 h-3.5" />
                      </Button>
                      {!player.is_admin
                        ? <Button size="sm" variant="ghost" onClick={() => handleMakeAdmin(player.id)} className="text-purple-400 hover:bg-purple-400/10 h-7 w-7 p-0" title="Make admin"><Shield className="w-3.5 h-3.5" /></Button>
                        : <Button size="sm" variant="ghost" onClick={() => handleRemoveAdmin(player.id)} className="text-slate-500 hover:bg-slate-500/10 h-7 w-7 p-0" title="Remove admin"><Shield className="w-3.5 h-3.5" /></Button>
                      }
                      {player.is_active
                        ? <Button size="sm" variant="ghost" onClick={() => handleSuspend(player.id)} className="text-red-400 hover:bg-red-400/10 h-7 w-7 p-0" title="Suspend"><Lock className="w-3.5 h-3.5" /></Button>
                        : <Button size="sm" variant="ghost" onClick={() => handleUnsuspend(player.id)} className="text-emerald-400 hover:bg-emerald-400/10 h-7 w-7 p-0" title="Unsuspend"><CheckCircle className="w-3.5 h-3.5" /></Button>
                      }
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {filtered.length === 0 && (
        <Card className="bg-slate-800/60 border-slate-700 p-12 text-center">
          <div className="text-slate-400">No players found matching your criteria</div>
        </Card>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          ADD SINGLE PLAYER MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={showAddModal} onOpenChange={open => { setShowAddModal(open); if (!open) resetAddForm() }}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-400" />Add Player
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              A verification email with their temporary password will be sent automatically.
            </DialogDescription>
          </DialogHeader>

          {newCreds ? (
            <div className="space-y-4">
              <div className={`p-3 rounded-lg border ${newCreds.emailSent ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <p className="text-sm font-semibold text-white">✅ Player created!</p>
                <p className="text-xs mt-0.5 text-slate-400">{newCreds.emailSent ? `Verification email sent to ${newCreds.email}.` : '⚠️ Email could not be sent — share credentials manually.'}</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="text-white">{newCreds.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="text-slate-200 font-mono text-xs">{newCreds.email}</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Temp Password</span>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-300 font-mono font-bold">{newCreds.tempPassword}</span>
                    <button onClick={() => { navigator.clipboard.writeText(newCreds!.tempPassword!); toast.success('Copied!') }} className="text-slate-500 hover:text-white"><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-slate-600 text-slate-300" onClick={resetAddForm}>Add Another</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setShowAddModal(false); resetAddForm() }}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {addError && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded p-2">{addError}</p>}
              <div><Label className="text-slate-300">Full Name <span className="text-red-400">*</span></Label><Input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Ahmed Khan" className="bg-slate-800 border-slate-700 text-white mt-2" /></div>
              <div><Label className="text-slate-300">Email Address <span className="text-red-400">*</span></Label><Input value={addEmail} onChange={e => setAddEmail(e.target.value)} type="email" placeholder="ahmed@example.com" className="bg-slate-800 border-slate-700 text-white mt-2" /></div>
              <div><Label className="text-slate-300">Phone <span className="text-slate-500 text-xs">(optional)</span></Label><Input value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="+92 300 1234567" className="bg-slate-800 border-slate-700 text-white mt-2" /></div>
              <Button onClick={handleAddPlayer} disabled={addLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
                {addLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</> : 'Create Player'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════════════════
          BULK UPLOAD MODAL
      ════════════════════════════════════════════════════════════════════ */}
      <Dialog open={showBulkModal} onOpenChange={open => { if (!open && bulkStep !== 'processing') { setShowBulkModal(false); resetBulk() } }}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Upload className="h-5 w-5 text-emerald-400" />Bulk Upload Players
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Upload a CSV file to create multiple player accounts at once.
              {bulkStep === 'processing' && ' Please do not close this window.'}
            </DialogDescription>
          </DialogHeader>

          {/* ── STEP 1: Upload ── */}
          {bulkStep === 'upload' && (
            <div className="space-y-5 flex-1">
              <div className="p-4 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-3">
                <p className="text-sm font-medium text-slate-300">CSV format</p>
                <p className="text-xs text-slate-500">Your file must have a header row with these columns:</p>
                <code className="block text-xs bg-slate-900 rounded p-2 text-emerald-300 font-mono">name, email, phone</code>
                <p className="text-xs text-slate-500">Phone is optional. One player per row.</p>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Download Template
                </Button>
              </div>

              <div
                className="border-2 border-dashed border-slate-600 rounded-xl p-10 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-slate-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-300">Click to select a CSV file</p>
                <p className="text-xs text-slate-500 mt-1">or drag and drop</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
              </div>
            </div>
          )}

          {/* ── STEP 2: Preview ── */}
          {bulkStep === 'preview' && (
            <div className="flex-1 min-h-0 flex flex-col space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" />{validBulkCount} ready</span>
                {invalidBulkCount > 0 && (
                  <span className="flex items-center gap-1 text-sm text-red-400"><XCircle className="h-4 w-4" />{invalidBulkCount} with errors (will be skipped)</span>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-slate-400 text-xs" onClick={() => { resetBulk(); fileRef.current?.click() }}>
                  Change file
                </Button>
              </div>

              {/* Preview table */}
              <div className="flex-1 min-h-0 overflow-y-auto border border-slate-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800 border-b border-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs text-slate-400 font-medium">Name</th>
                      <th className="text-left px-3 py-2 text-xs text-slate-400 font-medium">Email</th>
                      <th className="text-left px-3 py-2 text-xs text-slate-400 font-medium">Phone</th>
                      <th className="text-left px-3 py-2 text-xs text-slate-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {bulkRows.map((row, i) => {
                      const hasError = row.nameError || row.emailError
                      return (
                        <tr key={i} className={hasError ? 'bg-red-500/5' : ''}>
                          <td className="px-3 py-2 text-white">
                            {row.name || <span className="text-red-400 italic">missing</span>}
                            {row.nameError && <span className="text-red-400 text-xs ml-1">({row.nameError})</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-300 font-mono text-xs">
                            {row.email || <span className="text-red-400 italic">missing</span>}
                            {row.emailError && <span className="text-red-400 text-xs ml-1">({row.emailError})</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{row.phone || '—'}</td>
                          <td className="px-3 py-2">
                            {hasError
                              ? <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />Skip</span>
                              : <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Ready</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {validBulkCount === 0 ? (
                <p className="text-sm text-red-400 text-center">No valid rows to upload. Please fix the errors and try again.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    A 1.5s delay between accounts prevents email rate limits. {validBulkCount} players ≈ {Math.ceil(validBulkCount * 1.5 / 60)} min.
                  </div>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={runBulkCreate}>
                    Create {validBulkCount} Player{validBulkCount !== 1 ? 's' : ''} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Processing ── */}
          {bulkStep === 'processing' && (
            <div className="flex-1 flex flex-col items-center justify-center space-y-6 py-8">
              <Loader2 className="h-12 w-12 text-emerald-400 animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-white font-medium">Creating player {bulkProgress.current} of {bulkProgress.total}</p>
                <p className="text-slate-400 text-sm">{bulkCurrentName}</p>
                <p className="text-slate-600 text-xs mt-2">Waiting 1.5s between accounts to avoid email limits…</p>
              </div>
              {/* Progress bar */}
              <div className="w-full max-w-xs bg-slate-700 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">Do not close this window</p>
            </div>
          )}

          {/* ── STEP 4: Results ── */}
          {bulkStep === 'results' && (
            <div className="flex-1 min-h-0 flex flex-col space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{bulkResults.filter(r => r.success).length}</p>
                  <p className="text-xs text-emerald-300">Created</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{bulkResults.filter(r => !r.success).length}</p>
                  <p className="text-xs text-red-300">Failed</p>
                </div>
              </div>

              {/* Copy all button */}
              {bulkResults.some(r => r.success) && (
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 self-start" onClick={copyAllPasswords}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" />Copy all credentials
                </Button>
              )}

              {/* Results list */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {bulkResults.map((r, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${r.success ? 'bg-slate-800/60 border-slate-700/50' : 'bg-red-500/5 border-red-500/20'}`}>
                    {r.success ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{r.name}</p>
                      <p className="text-xs text-slate-500">{r.email}</p>
                      {r.success && r.tempPassword && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-500">Password:</span>
                          <span className="text-xs text-emerald-300 font-mono font-bold">{r.tempPassword}</span>
                          <button onClick={() => { navigator.clipboard.writeText(r.tempPassword!); toast.success('Copied!') }} className="text-slate-600 hover:text-white"><Copy className="h-3 w-3" /></button>
                        </div>
                      )}
                      {r.success && !r.emailSent && <p className="text-xs text-amber-400 mt-0.5">⚠️ Email failed — share manually</p>}
                      {!r.success && <p className="text-xs text-red-400 mt-0.5">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>

              <Button className="w-full bg-slate-700 hover:bg-slate-600" onClick={() => { setShowBulkModal(false); resetBulk() }}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
