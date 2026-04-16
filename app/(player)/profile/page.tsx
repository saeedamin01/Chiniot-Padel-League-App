'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { User, Mail, Phone, Lock, Loader2, Trophy, Shield, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Player, Team, LadderPosition, Tier } from '@/types'

interface TeamWithStats extends Team {
  ladder_position?: LadderPosition & { tier?: Tier }
  wins?: number
  losses?: number
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Player | null>(null)
  const [teams, setTeams] = useState<TeamWithStats[]>([])
  const [editingName, setEditingName] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.push('/login')
          return
        }

        // Fetch player profile
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('*')
          .eq('id', user.id)
          .single()

        if (playerError || !playerData) {
          toast.error('Failed to load profile')
          return
        }

        setProfile(playerData as Player)
        setName(playerData.name)
        setPhone(playerData.phone || '')

        // Fetch teams
        const { data: season } = await supabase
          .from('seasons')
          .select('id')
          .eq('is_active', true)
          .single()

        if (season) {
          const { data: playerTeams, error: teamsError } = await supabase
            .from('teams')
            .select(
              `
              *,
              player1:players!player1_id(id, name),
              player2:players!player2_id(id, name),
              ladder_position:ladder_positions!team_id(
                *,
                tier:tiers!tier_id(name, color, rank_order)
              )
            `
            )
            .eq('season_id', season.id)
            .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

          if (teamsError) {
            console.error('Failed to load teams:', teamsError)
            toast.error('Failed to load teams')
          }

          if (playerTeams && playerTeams.length > 0) {
            // Normalise ladder_position from array (PostgREST 1-to-many) to single object
            const normalised = playerTeams.map(t => ({
              ...t,
              ladder_position: Array.isArray(t.ladder_position)
                ? (t.ladder_position[0] ?? null)
                : (t.ladder_position ?? null),
            }))

            // Get win/loss stats for each team
            const teamStats = await Promise.all(
              normalised.map(async (team) => {
                const { count: wins } = await supabase
                  .from('match_results')
                  .select('id', { count: 'exact' })
                  .eq('season_id', season.id)
                  .eq('winner_team_id', team.id)

                const { count: losses } = await supabase
                  .from('match_results')
                  .select('id', { count: 'exact' })
                  .eq('season_id', season.id)
                  .eq('loser_team_id', team.id)

                return {
                  ...team,
                  wins: wins || 0,
                  losses: losses || 0,
                }
              })
            )

            setTeams(teamStats)
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err)
        toast.error('An error occurred while loading your profile')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [router, supabase])

  const handleUpdateName = async () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty')
      return
    }

    setSaving(true)

    try {
      const { error } = await supabase
        .from('players')
        .update({ name: name.trim() })
        .eq('id', profile!.id)

      if (error) {
        toast.error('Failed to update name')
        return
      }

      setProfile({ ...profile!, name: name.trim() })
      setEditingName(false)
      toast.success('Name updated successfully')
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdatePhone = async () => {
    setSaving(true)

    try {
      const { error } = await supabase
        .from('players')
        .update({ phone: phone.trim() || null })
        .eq('id', profile!.id)

      if (error) {
        toast.error('Failed to update phone')
        return
      }

      setProfile({ ...profile!, phone: phone.trim() || undefined })
      setEditingPhone(false)
      toast.success('Phone updated successfully')
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }

    setSaving(true)

    try {
      // Update password
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        toast.error(error.message || 'Failed to change password')
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setChangingPassword(false)
      toast.success('Password changed successfully')
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <Card className="bg-slate-800/60 border-slate-700/50 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">Profile Not Found</h3>
        <p className="text-slate-400">Unable to load your profile information</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">My Profile</h1>
        <p className="text-slate-400 mt-1">Manage your account information</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="bg-slate-800/60 border-slate-700/50">
          <TabsTrigger value="info">
            <User className="h-4 w-4 mr-2" />
            Account Info
          </TabsTrigger>
          <TabsTrigger value="security">
            <Lock className="h-4 w-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="teams">
            <Trophy className="h-4 w-4 mr-2" />
            My Teams
          </TabsTrigger>
        </TabsList>

        {/* Account Info */}
        <TabsContent value="info" className="space-y-4">
          {/* Email */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Mail className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold text-white">Email Address</h3>
            </div>
            <div className="p-3 bg-slate-700/30 rounded-lg">
              <p className="text-white font-medium">{profile.email}</p>
              <p className="text-xs text-slate-400 mt-1">
                {profile.email_verified ? (
                  <span className="text-emerald-400">Verified</span>
                ) : (
                  <span className="text-yellow-400">Pending verification</span>
                )}
              </p>
            </div>
          </Card>

          {/* Full Name */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <User className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold text-white">Full Name</h3>
            </div>
            {editingName ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateName}
                    disabled={saving}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                  >
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    onClick={() => {
                      setEditingName(false)
                      setName(profile.name)
                    }}
                    disabled={saving}
                    variant="ghost"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <p className="text-white font-medium">{profile.name}</p>
                <Button
                  onClick={() => setEditingName(true)}
                  variant="ghost"
                  size="sm"
                >
                  Edit
                </Button>
              </div>
            )}
          </Card>

          {/* Phone */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Phone className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold text-white">Phone Number</h3>
            </div>
            {editingPhone ? (
              <div className="space-y-3">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+92 300 1234567"
                  className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdatePhone}
                    disabled={saving}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                  >
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    onClick={() => {
                      setEditingPhone(false)
                      setPhone(profile.phone || '')
                    }}
                    disabled={saving}
                    variant="ghost"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <p className="text-white font-medium">
                  {profile.phone || <span className="text-slate-400">Not provided</span>}
                </p>
                <Button
                  onClick={() => setEditingPhone(true)}
                  variant="ghost"
                  size="sm"
                >
                  Edit
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-4">
          <Card className="bg-slate-800/60 border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="h-5 w-5 text-red-500" />
              <h3 className="text-lg font-semibold text-white">Change Password</h3>
            </div>

            {!changingPassword ? (
              <Button
                onClick={() => setChangingPassword(true)}
                className="w-full bg-emerald-500 hover:bg-emerald-600"
              >
                Change Password
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <p className="text-xs text-slate-400">Min 8 characters</p>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleChangePassword}
                    disabled={saving}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                  >
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Update Password
                  </Button>
                  <Button
                    onClick={() => {
                      setChangingPassword(false)
                      setCurrentPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                    }}
                    disabled={saving}
                    variant="ghost"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Account Status */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold text-white">Account Status</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between p-2">
                <span className="text-slate-300">Account Type</span>
                <span className="text-white font-medium">
                  {profile.is_admin ? 'Administrator' : 'Player'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2">
                <span className="text-slate-300">Status</span>
                <span className={`font-medium ${profile.is_active ? 'text-emerald-400' : 'text-red-400'}`}>
                  {profile.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Teams */}
        <TabsContent value="teams" className="space-y-4">
          {teams.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {teams.map((team) => (
                <Card key={team.id} className="bg-slate-800/60 border-slate-700/50 p-6">
                  <h3 className="text-lg font-semibold text-white mb-2">{team.name}</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    {team.player1?.name} & {team.player2?.name}
                  </p>

                  {team.ladder_position && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="p-2 bg-slate-700/30 rounded text-center">
                        <p className="text-xs text-slate-400">Rank</p>
                        <p className="font-semibold text-white">#{team.ladder_position.rank}</p>
                      </div>
                      <div className="p-2 bg-slate-700/30 rounded text-center">
                        <p className="text-xs text-slate-400">Wins</p>
                        <p className="font-semibold text-emerald-400">{team.wins || 0}</p>
                      </div>
                      <div className="p-2 bg-slate-700/30 rounded text-center">
                        <p className="text-xs text-slate-400">Losses</p>
                        <p className="font-semibold text-red-400">{team.losses || 0}</p>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-700">
                    <p className="text-xs text-slate-400 mb-2">Tier</p>
                    <p className="text-sm font-medium text-white">
                      {team.ladder_position?.tier?.name || 'Not ranked'}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="bg-slate-800/60 border-slate-700/50 p-8 text-center">
              <Trophy className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Teams Yet</h3>
              <p className="text-slate-400">You haven't joined any teams for the current season</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
