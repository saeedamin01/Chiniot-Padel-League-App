import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getActiveSeason } from '@/lib/ladder/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const season = await getActiveSeason()

    if (!season) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 })
    }

    return NextResponse.json({
      settings: season.league_settings,
      season,
    })
  } catch (err) {
    console.error('Error fetching settings:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin
    const { data: adminCheck } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { tiers: tiersPayload, season: seasonPayload, ...settingsPayload } = body

    const season = await getActiveSeason()
    if (!season) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 })
    }

    const adminClient = createAdminClient()

    // Get current settings for audit trail
    const { data: currentSettings } = await adminClient
      .from('league_settings')
      .select('*')
      .eq('season_id', season.id)
      .single()

    // Discover which columns actually exist in league_settings by reading the current row
    // (currentSettings keys = existing columns). Filter payload to only include known columns.
    const existingSettingsCols = new Set(Object.keys(currentSettings ?? {}))
    const safeSettingsPayload = Object.fromEntries(
      Object.entries(settingsPayload).filter(([key]) => existingSettingsCols.has(key))
    )

    // Update league_settings (only if there are settings fields that exist in the table)
    if (Object.keys(safeSettingsPayload).length > 0) {
      const { error: settingsError } = await adminClient
        .from('league_settings')
        .update(safeSettingsPayload)
        .eq('season_id', season.id)

      if (settingsError) {
        return NextResponse.json({ error: settingsError.message }, { status: 500 })
      }
    }

    // Update season if provided — filter to existing columns too
    if (seasonPayload && Object.keys(seasonPayload).length > 0) {
      const { data: currentSeasonRow } = await adminClient
        .from('seasons').select('*').eq('id', season.id).single()
      const existingSeasonCols = new Set(Object.keys(currentSeasonRow ?? {}))
      const safeSeasonPayload = Object.fromEntries(
        Object.entries(seasonPayload).filter(([key]) => existingSeasonCols.has(key))
      )
      if (Object.keys(safeSeasonPayload).length > 0) {
        const { error: seasonError } = await adminClient
          .from('seasons')
          .update(safeSeasonPayload)
          .eq('id', season.id)

        if (seasonError) {
          return NextResponse.json({ error: seasonError.message }, { status: 500 })
        }
      }
    }

    // Update tiers if provided
    if (Array.isArray(tiersPayload) && tiersPayload.length > 0) {
      for (const tier of tiersPayload) {
        const { error: tierError } = await adminClient
          .from('tiers')
          .update({
            name: tier.name,
            min_rank: tier.min_rank,
            max_rank: tier.max_rank,
            prize_1st: tier.prize_1st,
            prize_2nd: tier.prize_2nd,
            color: tier.color,
          })
          .eq('id', tier.id)

        if (tierError) {
          return NextResponse.json({ error: `Tier update failed: ${tierError.message}` }, { status: 500 })
        }
      }
    }

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'settings_updated',
      entity_type: 'league_settings',
      entity_id: season.id,
      old_value: currentSettings,
      new_value: body,
      created_at: new Date().toISOString(),
    })

    const { data: updatedSettings } = await adminClient
      .from('league_settings')
      .select('*')
      .eq('season_id', season.id)
      .single()

    return NextResponse.json({ settings: updatedSettings })
  } catch (err) {
    console.error('Error updating settings:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
