import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addDays } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const now = new Date()

    // Get active season + settings
    const { data: season } = await adminClient
      .from('seasons')
      .select('*, league_settings(*)')
      .eq('is_active', true)
      .single()

    if (!season) return NextResponse.json({ success: true, message: 'No active season' })

    const settings = season.league_settings as any

    // Load tiers for boundary checks and tier_id sync
    const { data: tiers } = await adminClient
      .from('tiers').select('id, min_rank, max_rank').eq('season_id', season.id)

    // Total teams on the ladder
    const { count: totalCount } = await adminClient
      .from('ladder_positions')
      .select('id', { count: 'exact' })
      .eq('season_id', season.id)
    const totalTeams = totalCount || 100

    // Find frozen teams whose drop is due
    const { data: frozenRecords } = await adminClient
      .from('freeze_records')
      .select('*')
      .eq('season_id', season.id)
      .is('unfrozen_at', null)
      .lte('next_drop_at', now.toISOString())

    if (!frozenRecords || frozenRecords.length === 0) {
      return NextResponse.json({ success: true, message: 'No teams to drop', processed: 0 })
    }

    let processed = 0

    for (const freeze of frozenRecords) {
      // Get current position + tier boundary
      const { data: pos } = await adminClient
        .from('ladder_positions')
        .select('id, rank, tier_id, tier:tiers!tier_id(max_rank)')
        .eq('team_id', freeze.team_id)
        .eq('season_id', season.id)
        .single()

      if (!pos) continue

      const currentRank = pos.rank as number

      // Rule 5: cannot drop below tier's lowest rank
      const tierData = Array.isArray(pos.tier) ? pos.tier[0] : pos.tier
      const tierMaxRank = (tierData as any)?.max_rank ?? totalTeams

      // Compute target rank
      const targetRank = Math.min(
        currentRank + settings.freeze_interval_drop,
        tierMaxRank,
        totalTeams
      )

      // If already at the tier floor, just reschedule — no movement
      if (targetRank <= currentRank) {
        const nextDrop = addDays(now, settings.freeze_interval_days)
        await adminClient.from('freeze_records')
          .update({ next_drop_at: nextDrop.toISOString() })
          .eq('id', freeze.id)
        continue
      }

      // ── Apply drop with correct rank shifting ──────────────────────────────
      // Phase A: park frozen team at temp rank 0 to vacate slot
      await adminClient.from('ladder_positions').update({ rank: 0 }).eq('id', (pos as any).id)

      // Phase B: shift non-frozen teams in [currentRank+1 .. targetRank] UP by 1
      // These teams fill the gap left by the dropping frozen team
      const { data: gapPositions } = await adminClient
        .from('ladder_positions')
        .select('id, rank, team_id, status')
        .eq('season_id', season.id)
        .gte('rank', currentRank + 1)
        .lte('rank', targetRank)
        .neq('status', 'frozen')

      const toFill = (gapPositions || []).sort((a, b) => a.rank - b.rank)

      // Sub-phase B1: park at negatives to avoid UNIQUE conflicts
      for (const p of toFill) {
        await adminClient.from('ladder_positions').update({ rank: -(p.rank) }).eq('id', p.id)
      }

      // Sub-phase B2: assign each team to rank - 1 (shift up)
      for (const p of toFill) {
        const r = p.rank - 1
        const newTierId = tiers?.find(t => r >= t.min_rank && r <= (t.max_rank ?? t.min_rank))?.id
        await adminClient.from('ladder_positions')
          .update({ rank: r, ...(newTierId ? { tier_id: newTierId } : {}) })
          .eq('id', p.id)
        await adminClient.from('ladder_history').insert({
          season_id: season.id, team_id: p.team_id,
          old_rank: p.rank, new_rank: r,
          change_type: 'freeze_drop', notes: 'Shifted up — frozen team above dropped',
        })
      }

      // Phase C: place frozen team at new rank
      const newTierId = tiers?.find(
        t => targetRank >= t.min_rank && targetRank <= (t.max_rank ?? t.min_rank)
      )?.id

      await adminClient.from('ladder_positions')
        .update({ rank: targetRank, ...(newTierId ? { tier_id: newTierId } : {}) })
        .eq('id', (pos as any).id)

      await adminClient.from('ladder_history').insert({
        season_id: season.id, team_id: freeze.team_id,
        old_rank: currentRank, new_rank: targetRank,
        change_type: 'freeze_drop', notes: 'Weekly freeze drop',
      })

      // Update freeze record: schedule next drop
      const nextDrop = addDays(now, settings.freeze_interval_days)
      await adminClient.from('freeze_records')
        .update({
          next_drop_at: nextDrop.toISOString(),
          drop_count: freeze.drop_count + (targetRank - currentRank),
        })
        .eq('id', freeze.id)

      // Notify both players
      const { data: teamData } = await adminClient
        .from('teams').select('player1_id, player2_id, name').eq('id', freeze.team_id).single()

      if (teamData) {
        const atFloor = targetRank === tierMaxRank ? ' (tier floor reached — no further drops)' : ''
        await adminClient.from('notifications').insert([
          {
            player_id: teamData.player1_id, team_id: freeze.team_id,
            type: 'freeze_drop', title: 'Weekly Freeze Drop',
            message: `${teamData.name} dropped to rank #${targetRank} while frozen${atFloor}.`,
            is_read: false, email_sent: false,
          },
          {
            player_id: teamData.player2_id, team_id: freeze.team_id,
            type: 'freeze_drop', title: 'Weekly Freeze Drop',
            message: `${teamData.name} dropped to rank #${targetRank} while frozen${atFloor}.`,
            is_read: false, email_sent: false,
          },
        ])
      }

      processed++
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} frozen team(s)`,
      processed,
    })
  } catch (err) {
    console.error('Cron freeze-drops error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
