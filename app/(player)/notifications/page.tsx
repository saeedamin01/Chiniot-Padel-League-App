'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Bell, CheckCircle2, Loader2, Trash2, Settings, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Notification, NotificationPreferences } from '@/types'

export default function NotificationsPage() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  // Open the tab specified in ?tab= URL param (e.g. ?tab=preferences from the dropdown)
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab')
    return t === 'preferences' || t === 'history' ? t : 'history'
  })
  const [updatingPrefs, setUpdatingPrefs] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          toast.error('Authentication required')
          return
        }

        // Fetch notifications
        const { data: notifs, error: notifError } = await supabase
          .from('notifications')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })

        if (!notifError) {
          setNotifications(notifs || [])
        }

        // Fetch preferences — create a default row if none exists yet
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('player_id', user.id)
          .single()

        if (prefs) {
          setPreferences(prefs as NotificationPreferences)
        } else {
          // First time: insert a default preferences row (all enabled)
          const { data: newPrefs } = await supabase
            .from('notification_preferences')
            .insert({ player_id: user.id })
            .select()
            .single()
          if (newPrefs) setPreferences(newPrefs as NotificationPreferences)
        }
      } catch (err) {
        console.error('Error fetching data:', err)
        toast.error('Failed to load notifications')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)

      if (error) {
        toast.error('Failed to mark notification as read')
        return
      }

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      )
    } catch (err) {
      toast.error('An error occurred')
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id)

      if (unreadIds.length === 0) {
        return
      }

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', unreadIds)

      if (error) {
        toast.error('Failed to mark notifications as read')
        return
      }

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      toast.success('All notifications marked as read')
    } catch (err) {
      toast.error('An error occurred')
    }
  }

  const handleDeleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)

      if (error) {
        toast.error('Failed to delete notification')
        return
      }

      setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
    } catch (err) {
      toast.error('An error occurred')
    }
  }

  const handlePreferenceChange = async (key: string, value: boolean) => {
    if (!preferences) return

    setUpdatingPrefs(true)

    try {
      const { error } = await supabase
        .from('notification_preferences')
        .update({ [key]: value })
        .eq('id', preferences.id)

      if (error) {
        toast.error('Failed to update preferences')
        setUpdatingPrefs(false)
        return
      }

      setPreferences({ ...preferences, [key]: value } as any)
      toast.success('Preferences updated')
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setUpdatingPrefs(false)
    }
  }

  const NotificationItem = ({ notification }: { notification: Notification }) => (
    <Card
      className={`border-slate-700/50 p-4 ${
        notification.is_read
          ? 'bg-slate-800/40'
          : 'bg-slate-800/60 border-l-2 border-l-emerald-500'
      }`}
    >
      <div className="flex items-start gap-4 justify-between">
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold truncate ${notification.is_read ? 'text-slate-200' : 'text-white'}`}>
            {notification.title}
          </h3>
          <p className="text-slate-400 text-sm mt-1">{notification.message}</p>
          <p className="text-xs text-slate-500 mt-2">
            {new Date(notification.created_at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!notification.is_read && (
            <button
              onClick={() => handleMarkAsRead(notification.id)}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              title="Mark as read"
            >
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </button>
          )}
          {notification.action_url && (
            <Link href={notification.action_url}>
              <Button size="sm" variant="ghost">
                View
              </Button>
            </Link>
          )}
          <button
            onClick={() => handleDeleteNotification(notification.id)}
            className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete notification"
          >
            <Trash2 className="h-5 w-5 text-red-500" />
          </button>
        </div>
      </div>
    </Card>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Notifications</h1>
        <p className="text-slate-400 mt-1 text-sm">Full history and preferences. New notifications appear in the bell menu.</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-slate-800/60 border-slate-700/50">
          <TabsTrigger value="history">
            History
            {notifications.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-slate-700 text-slate-300 rounded text-xs">
                {notifications.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="preferences">
            <Settings className="h-4 w-4 mr-2" />
            Preferences
          </TabsTrigger>
        </TabsList>

        {/* History */}
        <TabsContent value="history" className="space-y-3">
          {notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <NotificationItem key={notification.id} notification={notification} />
              ))}
            </div>
          ) : (
            <Card className="bg-slate-800/60 border-slate-700/50 p-8 text-center">
              <Bell className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Notifications</h3>
              <p className="text-slate-400">You're all caught up!</p>
            </Card>
          )}
        </TabsContent>

        {/* Unread Notifications */}
        {/* Preferences */}
        <TabsContent value="preferences" className="space-y-4">
          {preferences ? (
            <div className="space-y-6">
              {/* Email Preferences */}
              <Card className="bg-slate-800/60 border-slate-700/50 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Email Notifications</h3>
                <div className="space-y-3">
                  {[
                    { key: 'challenge_received_email', label: 'Challenges Received' },
                    { key: 'challenge_accepted_email', label: 'Challenges Accepted' },
                    { key: 'match_reminder_email', label: 'Match Reminders' },
                    { key: 'result_reported_email', label: 'Results Reported' },
                    { key: 'result_verified_email', label: 'Results Verified' },
                    { key: 'freeze_drop_email', label: 'Snowflake/Drop Updates' },
                    { key: 'admin_announcement_email', label: 'Admin Announcements' },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 cursor-pointer p-2 hover:bg-slate-700/30 rounded transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={(preferences as any)[key] || false}
                        onChange={(e) => handlePreferenceChange(key, e.target.checked)}
                        disabled={updatingPrefs}
                        className="h-4 w-4 accent-emerald-500 cursor-pointer disabled:opacity-50"
                      />
                      <span className="text-slate-200">{label}</span>
                    </label>
                  ))}
                </div>
              </Card>

              {/* In-App Preferences */}
              <Card className="bg-slate-800/60 border-slate-700/50 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">In-App Notifications</h3>
                <div className="space-y-3">
                  {[
                    { key: 'challenge_received_app', label: 'Challenges Received' },
                    { key: 'challenge_accepted_app', label: 'Challenges Accepted' },
                    { key: 'match_reminder_app', label: 'Match Reminders' },
                    { key: 'result_reported_app', label: 'Results Reported' },
                    { key: 'result_verified_app', label: 'Results Verified' },
                    { key: 'freeze_drop_app', label: 'Snowflake/Drop Updates' },
                    { key: 'admin_announcement_app', label: 'Admin Announcements' },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 cursor-pointer p-2 hover:bg-slate-700/30 rounded transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={(preferences as any)[key] || false}
                        onChange={(e) => handlePreferenceChange(key, e.target.checked)}
                        disabled={updatingPrefs}
                        className="h-4 w-4 accent-emerald-500 cursor-pointer disabled:opacity-50"
                      />
                      <span className="text-slate-200">{label}</span>
                    </label>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <Card className="bg-slate-800/60 border-slate-700/50 p-8 text-center">
              <AlertCircle className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Preferences Not Available</h3>
              <p className="text-slate-400">Unable to load your notification preferences</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
