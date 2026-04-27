import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processForfeit } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'
import { notifyAdmins } from '@/lib/notifications/service'
import { checkLeagueLock } from '@/lib/league/lock'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lockResponse = await checkLeagueLock()
    if (lockResponse) return lockResponse

    const body = await request.json()
    const { forfeitingTeamId } = body

    const adminClient = createAdminClient()

    // Get challenge
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // Verify user is on one of the teams
    const { data: team } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', forfeitingTeamId)
      .single()

    if (!team || (team.player1_id !== user.id && team.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Not authorized to forfeit this challenge' }, { status: 403 })
    }

    // Determine who is forfeiting
    const forfeitBy = forfeitingTeamId === challenge.challenging_team_id ? 'challenger' : 'challenged'

    // Process forfeit
    const result = await processForfeit(params.id, forfeitingTeamId)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // Update challenge
    const now = new Date()
    const { data: updated } = await adminClient
      .from('challenges')
      .update({
        status: 'forfeited',
        forfeit_by: forfeitBy,
        updated_at: now.toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    // Notify other team
    const otherTeamId = forfeitingTeamId === challenge.challenging_team_id
      ? challenge.challenged_team_id
      : challenge.challenging_team_id

    const { data: otherTeamData } = await adminClient
      .from('teams')
      .select('player1_id, player2_id, name')
      .eq('id', otherTeamId)
      .single()

    if (otherTeamData) {
      const notificationData = [
        {
          player_id: otherTeamData.player1_id,
          team_id: otherTeamId,
          type: 'challenge_forfeited',
          title: 'Challenge Forfeited',
          message: `${team.name} forfeited the challenge!`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: otherTeamData.player2_id,
          team_id: otherTeamId,
          type: 'challenge_forfeited',
          title: 'Challenge Forfeited',
          message: `${team.name} forfeited the challenge!`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
      ]

      await adminClient.from('notifications').insert(notificationData)
    }

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'challenge_forfeited',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: 'forfeited', forfeit_by: forfeitBy },
      created_at: now.toISOString(),
    })

    await logChallengeEvent({
      challengeId: params.id,
      eventType: 'forfeit',
      actorId: user.id,
      actorRole: 'player',
      actorName: team.name,
      data: { forfeit_by: forfeitBy },
    })

    // Notify admins of the forfeit
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await notifyAdmins({
      type: 'challenge_forfeited',
      title: '📋 Challenge forfeited',
      message: `${team.name} forfeited challenge ${challenge.challenge_code}. Ladder has been updated.`,
      actionUrl: `${appUrl}/admin/challenges`,
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error forfeiting challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
