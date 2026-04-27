import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

/**
 * Checks whether the active season's league is currently locked.
 *
 * Returns a 423 (Locked) NextResponse if the league is locked — the caller
 * should return this response immediately.
 * Returns null if the league is not locked (or the setting doesn't exist yet),
 * meaning the caller can proceed normally.
 *
 * Usage inside any player write route:
 *
 *   const lockResponse = await checkLeagueLock()
 *   if (lockResponse) return lockResponse
 */
export async function checkLeagueLock(): Promise<NextResponse | null> {
  try {
    const adminClient = createAdminClient()

    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    if (!season) return null // no active season → don't block

    const { data: settings } = await adminClient
      .from('league_settings')
      .select('is_locked')
      .eq('season_id', season.id)
      .single()

    if (settings?.is_locked) {
      return NextResponse.json(
        { error: 'The league is currently locked. No challenges or results can be submitted at this time.' },
        { status: 423 }
      )
    }

    return null
  } catch {
    // If the column doesn't exist yet (migration not run), treat as unlocked
    return null
  }
}
