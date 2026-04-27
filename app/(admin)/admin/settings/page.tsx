'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LeagueSettings, Tier, Season, Venue } from '@/types'
import { Save, AlertTriangle, Plus, Pencil, Trash2, MapPin, Check, X, Star, Lock, Unlock } from 'lucide-react'

interface SettingsForm extends LeagueSettings {
  seasonName?: string
  startDate?: string
  endDate?: string
  lastChallengeDate?: string
  seasonStatus?: string
}

interface VenueForm {
  name: string
  address: string
  notes: string
  is_partner: boolean
}

export default function SettingsPage() {
  const supabase = createClient()
  const [settings, setSettings] = useState<SettingsForm | null>(null)
  const [season, setSeason] = useState<Season | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [hasChanges, setHasChanges] = useState(false)

  // Venue management state
  const [venueForm, setVenueForm] = useState<VenueForm>({ name: '', address: '', notes: '', is_partner: false })
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null)
  const [showVenueForm, setShowVenueForm] = useState(false)
  const [venueSaving, setVenueSaving] = useState(false)
  const [venueMessage, setVenueMessage] = useState({ type: '', text: '' })

  // League lock state
  const [isLocked, setIsLocked] = useState(false)
  const [lockLoading, setLockLoading] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      setLoading(true)

      // Get active season
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('*')
        .eq('is_active', true)
        .single()

      if (!seasonData) {
        setLoading(false)
        return
      }

      setSeason(seasonData)

      // Get league settings
      const { data: settingsData } = await supabase
        .from('league_settings')
        .select('*')
        .eq('season_id', seasonData.id)
        .single()

      if (settingsData) {
        setSettings({
          ...settingsData,
          seasonName: seasonData.name,
          startDate: seasonData.start_date,
          endDate: seasonData.end_date,
          lastChallengeDate: seasonData.last_challenge_date,
          seasonStatus: seasonData.status,
        })
        setIsLocked(!!(settingsData as any).is_locked)
      }

      // Get tiers
      const { data: tiersData } = await supabase
        .from('tiers')
        .select('*')
        .eq('season_id', seasonData.id)
        .order('rank_order', { ascending: true })

      setTiers(tiersData || [])

      // Get venues (including inactive so admin can re-enable)
      const { data: venuesData } = await supabase
        .from('venues')
        .select('*')
        .eq('season_id', seasonData.id)
        .order('name')
      setVenues(venuesData || [])

    } catch (err) {
      console.error('Error loading settings:', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Venue helpers ────────────────────────────────────────────────────────────

  function startAddVenue() {
    setEditingVenueId(null)
    setVenueForm({ name: '', address: '', notes: '', is_partner: false })
    setShowVenueForm(true)
    setVenueMessage({ type: '', text: '' })
  }

  function startEditVenue(venue: Venue) {
    setEditingVenueId(venue.id)
    setVenueForm({ name: venue.name, address: venue.address || '', notes: venue.notes || '', is_partner: venue.is_partner })
    setShowVenueForm(true)
    setVenueMessage({ type: '', text: '' })
  }

  function cancelVenueForm() {
    setShowVenueForm(false)
    setEditingVenueId(null)
    setVenueForm({ name: '', address: '', notes: '', is_partner: false })
  }

  async function handleSaveVenue() {
    if (!venueForm.name.trim() || !season) return
    setVenueSaving(true)
    setVenueMessage({ type: '', text: '' })
    try {
      if (editingVenueId) {
        const res = await fetch(`/api/venues/${editingVenueId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...venueForm }),
        })
        if (!res.ok) throw new Error((await res.json()).error)
        const { venue } = await res.json()
        setVenues(prev => prev.map(v => v.id === editingVenueId ? venue : v))
      } else {
        const res = await fetch('/api/venues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seasonId: season.id, ...venueForm }),
        })
        if (!res.ok) throw new Error((await res.json()).error)
        const { venue } = await res.json()
        setVenues(prev => [...prev, venue].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setVenueMessage({ type: 'success', text: editingVenueId ? 'Venue updated.' : 'Venue added.' })
      cancelVenueForm()
    } catch (err: any) {
      setVenueMessage({ type: 'error', text: err.message || 'Failed to save venue' })
    } finally {
      setVenueSaving(false)
    }
  }

  async function handleToggleVenue(venue: Venue) {
    try {
      const res = await fetch(`/api/venues/${venue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !venue.is_active }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { venue: updated } = await res.json()
      setVenues(prev => prev.map(v => v.id === venue.id ? updated : v))
    } catch (err) {
      console.error('Failed to toggle venue:', err)
    }
  }

  function handleSettingChange(field: string, value: any) {
    setSettings(prev => prev ? { ...prev, [field]: value } : null)
    setHasChanges(true)
  }

  function handleTierChange(tierId: string, field: string, value: any) {
    setTiers(prev =>
      prev.map(t => t.id === tierId ? { ...t, [field]: value } : t)
    )
    setHasChanges(true)
  }

  async function handleToggleLock() {
    setLockLoading(true)
    try {
      const res = await fetch('/api/admin/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !isLocked }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to toggle lock')
      setIsLocked(data.is_locked)
      setMessage({ type: 'success', text: data.is_locked ? 'League locked — all player actions are now blocked.' : 'League unlocked — players can challenge and submit results again.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to toggle lock' })
    } finally {
      setLockLoading(false)
    }
  }

  async function handleSave() {
    if (!settings || !season) return

    try {
      setSaving(true)
      setMessage({ type: '', text: '' })

      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // League settings fields
          challenge_window_days: settings.challenge_window_days,
          challenge_accept_hours: settings.challenge_accept_hours,
          confirmation_window_hours: settings.confirmation_window_hours ?? 24,
          challenge_positions_above: settings.challenge_positions_above,
          max_active_challenges_out: settings.max_active_challenges_out,
          max_active_challenges_in: settings.max_active_challenges_in,
          consecutive_forfeit_limit: settings.consecutive_forfeit_limit,
          result_report_hours: settings.result_report_hours,
          result_verify_hours: settings.result_verify_hours,
          result_verify_minutes: settings.result_verify_minutes ?? 30,
          freeze_immediate_drop: settings.freeze_immediate_drop,
          freeze_interval_days: settings.freeze_interval_days,
          freeze_interval_drop: settings.freeze_interval_drop,
          forfeit_drop_positions: settings.forfeit_drop_positions,
          challenger_forfeit_drop_positions: (settings as any).challenger_forfeit_drop_positions ?? 0,
          sets_to_win: settings.sets_to_win,
          super_tiebreak_points: settings.super_tiebreak_points,
          tiebreak_points: settings.tiebreak_points,
          lateness_set_forfeit_minutes: settings.lateness_set_forfeit_minutes,
          lateness_match_forfeit_minutes: settings.lateness_match_forfeit_minutes,
          max_teams_per_player: settings.max_teams_per_player,
          inactivity_dissolve_days: settings.inactivity_dissolve_days,
          partner_change_drop_positions: settings.partner_change_drop_positions,
          slot_evening_count: (settings as any).slot_evening_count ?? 2,
          slot_weekend_count: (settings as any).slot_weekend_count ?? 1,
          slot_evening_start_hour: (settings as any).slot_evening_start_hour ?? 17,
          slot_evening_start_minute: (settings as any).slot_evening_start_minute ?? 30,
          slot_evening_end_hour: (settings as any).slot_evening_end_hour ?? 21,
          // Season fields (only if changed)
          ...(settings.seasonName || settings.startDate || settings.endDate ? {
            season: {
              name: settings.seasonName || season.name,
              start_date: settings.startDate || season.start_date,
              end_date: settings.endDate || season.end_date,
              last_challenge_date: settings.lastChallengeDate,
              status: settings.seasonStatus || season.status,
            }
          } : {}),
          // Tiers
          tiers: tiers.map(t => ({
            id: t.id,
            name: t.name,
            min_rank: t.min_rank,
            max_rank: t.max_rank,
            prize_1st: t.prize_1st,
            prize_2nd: t.prize_2nd,
            color: t.color,
          })),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      setMessage({ type: 'success', text: 'Settings saved successfully' })
      setHasChanges(false)
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save settings' })
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>No active season found. Please create a season first.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">League Settings</h1>
        {hasChanges && (
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </div>

      {message.text && (
        <Alert
          variant={message.type === 'success' ? 'default' : 'destructive'}
          className={message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : ''}
        >
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="challenge" className="w-full">
        <TabsList className="bg-slate-800 border-slate-700 flex-wrap h-auto gap-1">
          <TabsTrigger value="season">Season</TabsTrigger>
          <TabsTrigger value="venues">Venues</TabsTrigger>
          <TabsTrigger value="challenge">Challenge Rules</TabsTrigger>
          <TabsTrigger value="freeze">Snowflake Rules</TabsTrigger>
          <TabsTrigger value="forfeit">Forfeit Rules</TabsTrigger>
          <TabsTrigger value="result">Result Reporting</TabsTrigger>
          <TabsTrigger value="match">Match Format</TabsTrigger>
          <TabsTrigger value="player">Player Rules</TabsTrigger>
          <TabsTrigger value="tiers">Tier Configuration</TabsTrigger>
        </TabsList>

        {/* Season Tab */}
        <TabsContent value="season" className="space-y-4">

          {/* ── League Lock ── */}
          <Card className={`border p-5 ${isLocked ? 'bg-red-500/10 border-red-500/40' : 'bg-slate-800/60 border-slate-700'}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {isLocked
                  ? <Lock className="w-5 h-5 text-red-400 flex-shrink-0" />
                  : <Unlock className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                }
                <div>
                  <p className="font-semibold text-white">
                    League is currently <span className={isLocked ? 'text-red-400' : 'text-emerald-400'}>{isLocked ? 'LOCKED' : 'OPEN'}</span>
                  </p>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {isLocked
                      ? 'All player write actions are blocked. Admin actions and cron jobs continue normally.'
                      : 'Players can send challenges, submit scores, and take all normal actions.'}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleToggleLock}
                disabled={lockLoading}
                className={isLocked
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0'
                  : 'bg-red-600 hover:bg-red-700 text-white flex-shrink-0'}
              >
                {lockLoading
                  ? 'Saving…'
                  : isLocked
                    ? <><Unlock className="w-4 h-4 mr-1.5" />Unlock League</>
                    : <><Lock className="w-4 h-4 mr-1.5" />Lock League</>
                }
              </Button>
            </div>
          </Card>

          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="seasonName" className="text-slate-300">Season Name</Label>
                <Input
                  id="seasonName"
                  value={settings.seasonName || ''}
                  onChange={(e) => handleSettingChange('seasonName', e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startDate" className="text-slate-300">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={settings.startDate?.split('T')[0] || ''}
                    onChange={(e) => handleSettingChange('startDate', e.target.value)}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="endDate" className="text-slate-300">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={settings.endDate?.split('T')[0] || ''}
                    onChange={(e) => handleSettingChange('endDate', e.target.value)}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="lastChallengeDate" className="text-slate-300">Last Challenge Date</Label>
                <Input
                  id="lastChallengeDate"
                  type="date"
                  value={settings.lastChallengeDate?.split('T')[0] || ''}
                  onChange={(e) => handleSettingChange('lastChallengeDate', e.target.value)}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                  placeholder="No limit if empty"
                />
              </div>

              <div>
                <Label htmlFor="seasonStatus" className="text-slate-300">Status</Label>
                <select
                  id="seasonStatus"
                  value={settings.seasonStatus || 'active'}
                  onChange={(e) => handleSettingChange('seasonStatus', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 text-white rounded-md p-2 mt-2"
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Venues Tab */}
        <TabsContent value="venues" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-400" />
                  Match Venues
                </h3>
                <p className="text-slate-400 text-sm mt-1">
                  Players choose from these venues when scheduling a match. Add clubs and courts here.
                </p>
              </div>
              {!showVenueForm && (
                <Button
                  onClick={startAddVenue}
                  className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Venue
                </Button>
              )}
            </div>

            {venueMessage.text && (
              <div className={`text-sm mb-4 px-3 py-2 rounded ${venueMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
                {venueMessage.text}
              </div>
            )}

            {/* Add / Edit form */}
            {showVenueForm && (
              <div className="mb-6 p-4 bg-slate-900/60 border border-slate-600 rounded-lg space-y-3">
                <h4 className="text-white font-medium text-sm">
                  {editingVenueId ? 'Edit Venue' : 'New Venue'}
                </h4>
                <div>
                  <Label className="text-slate-300 text-xs">Name *</Label>
                  <Input
                    value={venueForm.name}
                    onChange={e => setVenueForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. CPL Padel Club"
                    className="bg-slate-800 border-slate-600 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 text-xs">Address</Label>
                  <Input
                    value={venueForm.address}
                    onChange={e => setVenueForm(p => ({ ...p, address: e.target.value }))}
                    placeholder="Street, City"
                    className="bg-slate-800 border-slate-600 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-slate-300 text-xs">Notes (e.g. discount details, special rules)</Label>
                  <Input
                    value={venueForm.notes}
                    onChange={e => setVenueForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="e.g. 20% discount for CPL members"
                    className="bg-slate-800 border-slate-600 text-white mt-1"
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setVenueForm(p => ({ ...p, is_partner: !p.is_partner }))}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors w-full mt-1 ${
                      venueForm.is_partner
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      venueForm.is_partner ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'
                    }`}>
                      {venueForm.is_partner && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <Star className="w-3.5 h-3.5 shrink-0" />
                    Partner venue
                    <span className="text-xs text-slate-500 ml-auto font-normal">Shown in highlighted section of picker</span>
                  </button>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSaveVenue}
                    disabled={venueSaving || !venueForm.name.trim()}
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    {venueSaving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button onClick={cancelVenueForm} variant="ghost" size="sm" className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Venue list */}
            {venues.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No venues added yet.</p>
                <p className="text-xs mt-1">Add venues so players can select a location when scheduling matches.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {venues.map(venue => (
                  <div
                    key={venue.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      venue.is_active
                        ? 'bg-slate-900/40 border-slate-700'
                        : 'bg-slate-900/20 border-slate-800 opacity-50'
                    }`}
                  >
                    <MapPin className={`w-4 h-4 mt-0.5 shrink-0 ${venue.is_partner ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium text-sm">{venue.name}</span>
                        {venue.is_partner && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                            <Star className="w-2.5 h-2.5" /> Partner
                          </span>
                        )}
                        {!venue.is_active && (
                          <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">inactive</span>
                        )}
                      </div>
                      {venue.address && (
                        <p className="text-slate-400 text-xs mt-0.5">{venue.address}</p>
                      )}
                      {venue.notes && (
                        <p className="text-emerald-400/70 text-xs mt-0.5">★ {venue.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const res = await fetch(`/api/venues/${venue.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_partner: !venue.is_partner }),
                          })
                          if (res.ok) {
                            const { venue: updated } = await res.json()
                            setVenues(prev => prev.map(v => v.id === venue.id ? updated : v))
                          }
                        }}
                        className={`h-8 w-8 p-0 ${venue.is_partner ? 'text-emerald-400 hover:text-slate-400' : 'text-slate-500 hover:text-emerald-400'}`}
                        title={venue.is_partner ? 'Remove partner status' : 'Mark as partner'}
                      >
                        <Star className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditVenue(venue)}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleVenue(venue)}
                        className={`h-8 w-8 p-0 ${venue.is_active ? 'text-slate-400 hover:text-red-400' : 'text-slate-500 hover:text-emerald-400'}`}
                        title={venue.is_active ? 'Deactivate' : 'Reactivate'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Challenge Rules Tab */}
        <TabsContent value="challenge" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="challengeWindow" className="text-slate-300">
                  Challenge Window (days) <span className="text-slate-500 text-sm">default: 10</span>
                </Label>
                <Input
                  id="challengeWindow"
                  type="number"
                  min="1"
                  value={settings.challenge_window_days}
                  onChange={(e) => handleSettingChange('challenge_window_days', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Days to play a challenge after accepting</p>
              </div>

              <div>
                <Label htmlFor="acceptDeadline" className="text-slate-300">
                  Challenge Accept Deadline (hours) <span className="text-slate-500 text-sm">default: 24</span>
                </Label>
                <Input
                  id="acceptDeadline"
                  type="number"
                  min="1"
                  value={settings.challenge_accept_hours}
                  onChange={(e) => handleSettingChange('challenge_accept_hours', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Hours the challenged team has to accept and enter a confirmed time</p>
              </div>

              <div>
                <Label htmlFor="confirmationWindow" className="text-slate-300">
                  Confirmation Window (hours) <span className="text-slate-500 text-sm">default: 24</span>
                </Label>
                <Input
                  id="confirmationWindow"
                  type="number"
                  min="1"
                  value={settings.confirmation_window_hours ?? 24}
                  onChange={(e) => handleSettingChange('confirmation_window_hours', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Hours the challenging team has to confirm the time entered by the challenged team — auto-confirms if they don't respond</p>
              </div>

              <div>
                <Label htmlFor="maxPositionsAbove" className="text-slate-300">
                  Max Positions Above to Challenge <span className="text-slate-500 text-sm">default: 3</span>
                </Label>
                <Input
                  id="maxPositionsAbove"
                  type="number"
                  min="1"
                  value={settings.challenge_positions_above}
                  onChange={(e) => handleSettingChange('challenge_positions_above', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="maxOut" className="text-slate-300">Max Active Challenges Out</Label>
                  <Input
                    id="maxOut"
                    type="number"
                    min="1"
                    value={settings.max_active_challenges_out}
                    onChange={(e) => handleSettingChange('max_active_challenges_out', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="maxIn" className="text-slate-300">Max Active Challenges In</Label>
                  <Input
                    id="maxIn"
                    type="number"
                    min="1"
                    value={settings.max_active_challenges_in}
                    onChange={(e) => handleSettingChange('max_active_challenges_in', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>
              </div>

              {/* Time Slot Requirements */}
              <div className="border-t border-slate-700 pt-4 mt-2">
                <h3 className="text-white font-medium mb-3">Time Slot Requirements</h3>
                <p className="text-xs text-slate-400 mb-4">
                  When sending a challenge, challengers must offer 3 time slots that meet these requirements. Note: Friday is treated as a weekday.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="slotEveningCount" className="text-slate-300">
                      Evening Slots Required <span className="text-slate-500 text-sm">default: 2</span>
                    </Label>
                    <Input
                      id="slotEveningCount"
                      type="number"
                      min="0"
                      max="3"
                      value={(settings as any).slot_evening_count ?? 2}
                      onChange={(e) => handleSettingChange('slot_evening_count', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="slotWeekendCount" className="text-slate-300">
                      Weekend Slots Required <span className="text-slate-500 text-sm">default: 1</span>
                    </Label>
                    <Input
                      id="slotWeekendCount"
                      type="number"
                      min="0"
                      max="3"
                      value={(settings as any).slot_weekend_count ?? 1}
                      onChange={(e) => handleSettingChange('slot_weekend_count', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                    <p className="text-xs text-slate-500 mt-1">Saturday & Sunday count as weekend</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <Label htmlFor="slotEveningStart" className="text-slate-300">
                      Evening Start Hour (24h) <span className="text-slate-500 text-sm">default: 17 (5 PM)</span>
                    </Label>
                    <Input
                      id="slotEveningStart"
                      type="number"
                      min="0"
                      max="23"
                      value={(settings as any).slot_evening_start_hour ?? 17}
                      onChange={(e) => handleSettingChange('slot_evening_start_hour', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="slotEveningEnd" className="text-slate-300">
                      Evening End Hour (24h) <span className="text-slate-500 text-sm">default: 21 (9 PM)</span>
                    </Label>
                    <Input
                      id="slotEveningEnd"
                      type="number"
                      min="0"
                      max="24"
                      value={(settings as any).slot_evening_end_hour ?? 21}
                      onChange={(e) => handleSettingChange('slot_evening_end_hour', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>
                </div>

                {/* Preview */}
                <div className="mt-4 p-3 bg-slate-900/60 border border-slate-600 rounded-lg text-xs text-slate-300">
                  <span className="text-slate-400 font-medium block mb-1">Current requirement preview:</span>
                  {(settings as any).slot_evening_count > 0 && (
                    <div>• {(settings as any).slot_evening_count ?? 2} × Evening slot{((settings as any).slot_evening_count ?? 2) > 1 ? 's' : ''} ({
                      (() => {
                        const h = (settings as any).slot_evening_start_hour ?? 17
                        const m = (settings as any).slot_evening_start_minute ?? 30
                        const mm = m === 0 ? '00' : String(m)
                        return h === 0 ? `12:${mm} AM` : h < 12 ? `${h}:${mm} AM` : h === 12 ? `12:${mm} PM` : `${h - 12}:${mm} PM`
                      })()
                    } – {
                      (() => {
                        const h = (settings as any).slot_evening_end_hour ?? 21
                        return h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`
                      })()
                    })</div>
                  )}
                  {(settings as any).slot_weekend_count > 0 && (
                    <div>• {(settings as any).slot_weekend_count ?? 1} × Weekend slot{((settings as any).slot_weekend_count ?? 1) > 1 ? 's' : ''} (Saturday or Sunday)</div>
                  )}
                  <div className="text-slate-500 mt-1">Friday = weekday</div>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Snowflake Rules Tab */}
        <TabsContent value="freeze" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="freezeImmediate" className="text-slate-300">
                  Immediate Drop Positions <span className="text-slate-500 text-sm">default: 1</span>
                </Label>
                <Input
                  id="freezeImmediate"
                  type="number"
                  min="0"
                  value={settings.freeze_immediate_drop}
                  onChange={(e) => handleSettingChange('freeze_immediate_drop', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Positions to drop when team is frozen</p>
              </div>

              <div>
                <Label htmlFor="freezeInterval" className="text-slate-300">
                  Drop Interval (days) <span className="text-slate-500 text-sm">default: 7</span>
                </Label>
                <Input
                  id="freezeInterval"
                  type="number"
                  min="1"
                  value={settings.freeze_interval_days}
                  onChange={(e) => handleSettingChange('freeze_interval_days', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Days between drops while frozen</p>
              </div>

              <div>
                <Label htmlFor="freezeIntervalDrop" className="text-slate-300">
                  Positions Dropped Per Interval <span className="text-slate-500 text-sm">default: 1</span>
                </Label>
                <Input
                  id="freezeIntervalDrop"
                  type="number"
                  min="0"
                  value={settings.freeze_interval_drop}
                  onChange={(e) => handleSettingChange('freeze_interval_drop', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Forfeit Rules Tab */}
        <TabsContent value="forfeit" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="forfeitDrop" className="text-slate-300">
                  Challenged Team Forfeit Drop <span className="text-slate-500 text-sm">default: 2</span>
                </Label>
                <Input
                  id="forfeitDrop"
                  type="number"
                  min="1"
                  value={settings.forfeit_drop_positions}
                  onChange={(e) => handleSettingChange('forfeit_drop_positions', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Positions the challenged team drops if they forfeit</p>
              </div>

              <div>
                <Label htmlFor="challengerForfeitDrop" className="text-slate-300">
                  Challenger Forfeit Drop <span className="text-slate-500 text-sm">default: 0</span>
                </Label>
                <Input
                  id="challengerForfeitDrop"
                  type="number"
                  min="0"
                  value={(settings as any).challenger_forfeit_drop_positions ?? 0}
                  onChange={(e) => handleSettingChange('challenger_forfeit_drop_positions', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Positions the challenger drops if they forfeit their own challenge (0 = no penalty)</p>
              </div>

              <div>
                <Label htmlFor="consecutiveLimit" className="text-slate-300">
                  Consecutive Forfeit Limit <span className="text-slate-500 text-sm">default: 3</span>
                </Label>
                <Input
                  id="consecutiveLimit"
                  type="number"
                  min="1"
                  value={settings.consecutive_forfeit_limit}
                  onChange={(e) => handleSettingChange('consecutive_forfeit_limit', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Consecutive forfeits before dropping to bottom</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Result Reporting Tab */}
        <TabsContent value="result" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="reportHours" className="text-slate-300">
                  Report Result Hours <span className="text-slate-500 text-sm">default: 2</span>
                </Label>
                <Input
                  id="reportHours"
                  type="number"
                  min="1"
                  value={settings.result_report_hours}
                  onChange={(e) => handleSettingChange('result_report_hours', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Hours after match to report result</p>
              </div>

              <div>
                <Label htmlFor="verifyMinutes" className="text-slate-300">
                  Result Verification Window (minutes) <span className="text-slate-500 text-sm">default: 30</span>
                </Label>
                <Input
                  id="verifyMinutes"
                  type="number"
                  min="1"
                  value={settings.result_verify_minutes ?? 30}
                  onChange={(e) => handleSettingChange('result_verify_minutes', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">Minutes for opposing team to verify or dispute before result is auto-approved</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Match Format Tab */}
        <TabsContent value="match" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="setsToWin" className="text-slate-300">Sets to Win <span className="text-slate-500 text-sm">default: 2</span></Label>
                  <Input
                    id="setsToWin"
                    type="number"
                    min="1"
                    value={settings.sets_to_win}
                    onChange={(e) => handleSettingChange('sets_to_win', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="superTiebreak" className="text-slate-300">Super Tiebreak Points <span className="text-slate-500 text-sm">default: 10</span></Label>
                  <Input
                    id="superTiebreak"
                    type="number"
                    min="1"
                    value={settings.super_tiebreak_points}
                    onChange={(e) => handleSettingChange('super_tiebreak_points', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="tiebreakPoints" className="text-slate-300">Tiebreak Points (at 6-6) <span className="text-slate-500 text-sm">default: 7</span></Label>
                <Input
                  id="tiebreakPoints"
                  type="number"
                  min="1"
                  value={settings.tiebreak_points}
                  onChange={(e) => handleSettingChange('tiebreak_points', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="lateSSet" className="text-slate-300">Lateness Forfeit Set (minutes) <span className="text-slate-500 text-sm">default: 15</span></Label>
                  <Input
                    id="lateSSet"
                    type="number"
                    min="1"
                    value={settings.lateness_set_forfeit_minutes}
                    onChange={(e) => handleSettingChange('lateness_set_forfeit_minutes', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="lateMatch" className="text-slate-300">Lateness Forfeit Match (minutes) <span className="text-slate-500 text-sm">default: 25</span></Label>
                  <Input
                    id="lateMatch"
                    type="number"
                    min="1"
                    value={settings.lateness_match_forfeit_minutes}
                    onChange={(e) => handleSettingChange('lateness_match_forfeit_minutes', parseInt(e.target.value))}
                    className="bg-slate-900 border-slate-600 text-white mt-2"
                  />
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Player Rules Tab */}
        <TabsContent value="player" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700 p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="maxTeams" className="text-slate-300">Max Teams Per Player <span className="text-slate-500 text-sm">default: 2</span></Label>
                <Input
                  id="maxTeams"
                  type="number"
                  min="1"
                  value={settings.max_teams_per_player}
                  onChange={(e) => handleSettingChange('max_teams_per_player', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>

              <div>
                <Label htmlFor="inactivityDays" className="text-slate-300">Inactivity Dissolve Days <span className="text-slate-500 text-sm">default: 15</span></Label>
                <Input
                  id="inactivityDays"
                  type="number"
                  min="1"
                  value={settings.inactivity_dissolve_days}
                  onChange={(e) => handleSettingChange('inactivity_dissolve_days', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>

              <div>
                <Label htmlFor="partnerChangeDrop" className="text-slate-300">Partner Change Drop Positions <span className="text-slate-500 text-sm">default: 3</span></Label>
                <Input
                  id="partnerChangeDrop"
                  type="number"
                  min="0"
                  value={settings.partner_change_drop_positions}
                  onChange={(e) => handleSettingChange('partner_change_drop_positions', parseInt(e.target.value))}
                  className="bg-slate-900 border-slate-600 text-white mt-2"
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Tier Configuration Tab */}
        <TabsContent value="tiers" className="space-y-4">
          {tiers.map((tier) => (
            <Card key={tier.id} className="bg-slate-800/60 border-slate-700 p-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Tier Name</Label>
                    <Input
                      value={tier.name}
                      onChange={(e) => handleTierChange(tier.id, 'name', e.target.value)}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>

                  <div>
                    <Label className="text-slate-300">Color</Label>
                    <div className="flex gap-2 mt-2">
                      <input
                        type="color"
                        value={tier.color}
                        onChange={(e) => handleTierChange(tier.id, 'color', e.target.value)}
                        className="w-12 h-10 rounded cursor-pointer"
                      />
                      <Input
                        value={tier.color}
                        onChange={(e) => handleTierChange(tier.id, 'color', e.target.value)}
                        className="bg-slate-900 border-slate-600 text-white flex-1"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Min Rank</Label>
                    <Input
                      type="number"
                      value={tier.min_rank}
                      onChange={(e) => handleTierChange(tier.id, 'min_rank', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>

                  <div>
                    <Label className="text-slate-300">Max Rank</Label>
                    <Input
                      type="number"
                      value={tier.max_rank || ''}
                      onChange={(e) => handleTierChange(tier.id, 'max_rank', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="No limit if empty"
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">1st Prize Amount</Label>
                    <Input
                      type="number"
                      value={tier.prize_1st}
                      onChange={(e) => handleTierChange(tier.id, 'prize_1st', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>

                  <div>
                    <Label className="text-slate-300">2nd Prize Amount</Label>
                    <Input
                      type="number"
                      value={tier.prize_2nd}
                      onChange={(e) => handleTierChange(tier.id, 'prize_2nd', parseInt(e.target.value))}
                      className="bg-slate-900 border-slate-600 text-white mt-2"
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {hasChanges && (
        <div className="flex justify-center pt-6">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 px-8"
            size="lg"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save All Changes'}
          </Button>
        </div>
      )}
    </div>
  )
}
