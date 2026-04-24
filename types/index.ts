export type PlayerStatus = 'active' | 'inactive'
export type TeamStatus = 'active' | 'frozen' | 'dissolved' | 'inactive'
export type ChallengeStatus =
  | 'pending'
  | 'accepted'
  | 'accepted_open'
  | 'time_pending_confirm'
  | 'revision_proposed'
  | 'reschedule_requested'
  | 'reschedule_pending_admin'
  | 'scheduled'
  | 'result_pending'
  | 'played'
  | 'forfeited'
  | 'dissolved'
export type ForfeitBy = 'challenger' | 'challenged'
export type TierName = 'Diamond' | 'Platinum' | 'Gold' | 'Silver' | 'Bronze'
export type TicketType = 'tier' | 'silver' | 'gold'
export type TicketStatus = 'active' | 'used' | 'forfeited' | 'converted'
export type LadderChangeType = 'challenge_win' | 'challenge_loss' | 'forfeit' | 'freeze_drop' | 'admin_adjustment' | 'season_start' | 'partner_change' | 'dissolved'
export type SeasonStatus = 'upcoming' | 'active' | 'completed'

export interface Player {
  id: string
  email: string
  name: string
  phone?: string
  email_verified: boolean
  email_verified_at?: string
  avatar_url?: string
  is_admin: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Season {
  id: string
  name: string
  season_number: number
  start_date: string
  end_date: string
  last_challenge_date?: string
  is_active: boolean
  status: SeasonStatus
  created_at: string
  updated_at: string
}

export interface LeagueSettings {
  id: string
  season_id: string
  challenge_window_days: number
  challenge_accept_hours: number
  confirmation_window_hours: number
  challenge_positions_above: number
  max_active_challenges_out: number
  max_active_challenges_in: number
  consecutive_forfeit_limit: number
  result_report_hours: number
  result_verify_hours: number
  result_verify_minutes: number
  dispute_window_minutes: number   // Phase 6 — minutes reporter has to accept counter-score
  freeze_immediate_drop: number
  freeze_interval_days: number
  freeze_interval_drop: number
  forfeit_drop_positions: number
  sets_to_win: number
  super_tiebreak_points: number
  tiebreak_points: number
  lateness_set_forfeit_minutes: number
  lateness_match_forfeit_minutes: number
  max_teams_per_player: number
  inactivity_dissolve_days: number
  partner_change_drop_positions: number
  time_slots_required: number
  created_at: string
  updated_at: string
}

export interface Venue {
  id: string
  season_id: string
  name: string
  address?: string
  notes?: string
  is_active: boolean
  is_partner: boolean
  created_at: string
  updated_at: string
}

export interface Tier {
  id: string
  season_id: string
  name: TierName
  rank_order: number
  color: string
  min_rank: number
  max_rank?: number
  prize_1st: number
  prize_2nd: number
  promotion_bonus: number
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  season_id: string
  name: string
  player1_id: string
  player2_id: string
  status: TeamStatus
  is_new_team: boolean
  partner_changed: boolean
  entry_fee_paid: boolean
  created_at: string
  updated_at: string
  // Joined fields
  player1?: Player
  player2?: Player
  ladder_position?: LadderPosition
}

export interface LadderPosition {
  id: string
  team_id: string
  season_id: string
  rank: number
  tier_id: string
  status: 'active' | 'frozen'
  consecutive_forfeits: number
  last_challenged_team_id?: string
  created_at: string
  updated_at: string
  // Joined
  team?: Team
  tier?: Tier
}

export interface Ticket {
  id: string
  team_id: string
  season_id: string
  ticket_type: TicketType
  status?: TicketStatus  // Optional: added in migration 005; falls back to is_used when absent
  // Legacy boolean — kept for backwards compat
  is_used: boolean
  used_at?: string
  expires_after_first_match: boolean
  // New fields from migration 005
  challenge_id?: string | null     // challenge this ticket was linked to
  assigned_by?: string | null      // player_id of admin who assigned it
  assigned_reason?: string | null  // e.g. "late entry", "previous league position"
  forfeited_at?: string | null
  created_at: string
  updated_at?: string  // Added in migration 005
}

export interface Challenge {
  id: string
  challenge_code: string
  season_id: string
  challenging_team_id: string
  challenged_team_id: string
  tier_id: string
  status: ChallengeStatus
  forfeit_by?: ForfeitBy
  issued_at: string
  accept_deadline: string
  match_deadline: string
  slot_1?: string
  slot_2?: string
  slot_3?: string
  accepted_slot?: string
  // New scheduling fields
  venue_id?: string | null
  confirmed_time?: string | null
  confirmation_deadline?: string | null
  // Legacy / kept for existing data
  match_location?: string
  match_date?: string
  proposed_slot?: string | null
  proposed_location?: string | null
  ticket_id?: string
  accepted_at?: string
  scheduled_at?: string
  dissolved_reason?: string | null
  // Migration 016: tracks who entered the agreed time so the correct other team confirms
  time_submitted_by_team_id?: string | null
  created_at: string
  updated_at: string
  // Joined
  challenging_team?: Team
  challenged_team?: Team
  tier?: Tier
  match_result?: MatchResult
  venue?: Venue
}

export interface DisputedScore {
  set1_challenger: number
  set1_challenged: number
  set2_challenger: number
  set2_challenged: number
  supertiebreak_challenger?: number | null
  supertiebreak_challenged?: number | null
  winner_team_id: string
}

export interface MatchResult {
  id: string
  challenge_id: string
  season_id: string
  winner_team_id: string
  loser_team_id: string
  set1_challenger?: number
  set1_challenged?: number
  set2_challenger?: number
  set2_challenged?: number
  supertiebreak_challenger?: number
  supertiebreak_challenged?: number
  reported_by_team_id: string
  verified_by_team_id?: string
  match_date?: string
  match_location?: string
  reported_at: string
  verify_deadline?: string
  verified_at?: string
  auto_verified: boolean
  // Phase 6 — dispute fields
  disputed_score?: DisputedScore | null
  disputed_at?: string | null
  dispute_resolved_by?: string | null
  dispute_resolved_at?: string | null
  dispute_flagged_at?: string | null
  created_at: string
  // Joined
  winner_team?: Team
  loser_team?: Team
}

export interface FreezeRecord {
  id: string
  team_id: string
  season_id: string
  rank_at_freeze: number
  tier_id: string
  frozen_at: string
  unfrozen_at?: string
  next_drop_at?: string
  drop_count: number
  reason?: string
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  actor_id?: string
  actor_email: string
  action_type: string
  entity_type: string
  entity_id?: string
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  notes?: string
  ip_address?: string
  created_at: string
  // Joined
  actor?: Player
}

export interface Notification {
  id: string
  player_id: string
  team_id?: string
  type: string
  title: string
  message: string
  action_url?: string
  is_read: boolean
  read_at?: string
  email_sent: boolean
  email_sent_at?: string
  created_at: string
}

export interface NotificationPreferences {
  id: string
  player_id: string
  challenge_received_email: boolean
  challenge_accepted_email: boolean
  match_reminder_email: boolean
  result_reported_email: boolean
  result_verified_email: boolean
  freeze_drop_email: boolean
  admin_announcement_email: boolean
  challenge_received_app: boolean
  challenge_accepted_app: boolean
  match_reminder_app: boolean
  result_reported_app: boolean
  result_verified_app: boolean
  freeze_drop_app: boolean
  admin_announcement_app: boolean
}

// Extended types for UI
export interface LadderEntry {
  rank: number
  team: Team
  tier: Tier
  status: 'active' | 'frozen'
  active_challenge_out?: Challenge
  active_challenge_in?: Challenge
  consecutive_forfeits: number
}

export interface TeamStats {
  team_id: string
  total_wins: number
  total_losses: number
  total_matches: number
  win_percentage: number
  current_rank?: number
  tier?: Tier
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChallengeChat {
  id: string
  challenge_id: string
  allowed_player_ids: string[]
  last_email_sent_at: string | null
  created_at: string
  // Joined fields
  challenge?: {
    id: string
    challenge_code: string
    challenging_team?: { id: string; name: string }
    challenged_team?: { id: string; name: string }
  }
}

export interface ChatMessage {
  id: string
  chat_id: string
  sender_id: string
  content: string
  read_by: string[]
  created_at: string
  reply_to_message_id?: string | null
  reactions?: Record<string, string[]>
  // Joined sender info
  sender?: {
    id: string
    name: string
    avatar_url?: string | null
  }
  // Joined reply-to message (when reply_to_message_id is set)
  reply_to?: {
    id: string
    content: string
    sender?: { id: string; name: string } | null
  } | null
}
