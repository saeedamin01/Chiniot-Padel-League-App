-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- PLAYERS TABLE
-- =============================================
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- SEASONS TABLE
-- =============================================
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  last_challenge_date DATE,
  is_active BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- LEAGUE SETTINGS TABLE
-- =============================================
CREATE TABLE league_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  -- Challenge rules
  challenge_window_days INTEGER DEFAULT 10,
  challenge_accept_hours INTEGER DEFAULT 24,
  challenge_positions_above INTEGER DEFAULT 3,
  max_active_challenges_out INTEGER DEFAULT 1,
  max_active_challenges_in INTEGER DEFAULT 1,
  consecutive_forfeit_limit INTEGER DEFAULT 3,
  -- Result reporting
  result_report_hours INTEGER DEFAULT 2,
  result_verify_hours INTEGER DEFAULT 24,
  -- Freeze rules
  freeze_immediate_drop INTEGER DEFAULT 1,
  freeze_interval_days INTEGER DEFAULT 7,
  freeze_interval_drop INTEGER DEFAULT 1,
  -- Forfeit rules
  forfeit_drop_positions INTEGER DEFAULT 2,
  -- Match format
  sets_to_win INTEGER DEFAULT 2,
  super_tiebreak_points INTEGER DEFAULT 10,
  tiebreak_points INTEGER DEFAULT 7,
  lateness_set_forfeit_minutes INTEGER DEFAULT 15,
  lateness_match_forfeit_minutes INTEGER DEFAULT 25,
  -- Team rules
  max_teams_per_player INTEGER DEFAULT 2,
  -- Inactivity
  inactivity_dissolve_days INTEGER DEFAULT 15,
  -- Partner change
  partner_change_drop_positions INTEGER DEFAULT 3,
  -- Scoring slots required
  time_slots_required INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id)
);

-- =============================================
-- TIERS TABLE
-- =============================================
CREATE TABLE tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rank_order INTEGER NOT NULL,
  color TEXT NOT NULL,
  min_rank INTEGER NOT NULL,
  max_rank INTEGER,
  prize_1st INTEGER DEFAULT 0,
  prize_2nd INTEGER DEFAULT 0,
  promotion_bonus INTEGER DEFAULT 5000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, name),
  UNIQUE(season_id, rank_order)
);

-- =============================================
-- TEAMS TABLE
-- =============================================
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  player1_id UUID REFERENCES players(id),
  player2_id UUID REFERENCES players(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'dissolved', 'inactive')),
  is_new_team BOOLEAN DEFAULT FALSE,
  partner_changed BOOLEAN DEFAULT FALSE,
  entry_fee_paid BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, name)
);

-- =============================================
-- LADDER POSITIONS TABLE
-- =============================================
CREATE TABLE ladder_positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  tier_id UUID REFERENCES tiers(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  consecutive_forfeits INTEGER DEFAULT 0,
  last_challenged_team_id UUID REFERENCES teams(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, rank)
);

-- =============================================
-- TICKETS TABLE (special challenge tickets)
-- =============================================
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('tier', 'silver', 'gold')),
  is_used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  expires_after_first_match BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- CHALLENGES TABLE
-- =============================================
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_code TEXT UNIQUE NOT NULL,
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  challenging_team_id UUID REFERENCES teams(id),
  challenged_team_id UUID REFERENCES teams(id),
  tier_id UUID REFERENCES tiers(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'played', 'forfeited', 'dissolved')),
  forfeit_by TEXT CHECK (forfeit_by IN ('challenger', 'challenged', NULL)),
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  accept_deadline TIMESTAMPTZ NOT NULL,
  match_deadline TIMESTAMPTZ NOT NULL,
  -- Time slots offered by challenger (3 required)
  slot_1 TIMESTAMPTZ,
  slot_2 TIMESTAMPTZ,
  slot_3 TIMESTAMPTZ,
  -- Accepted slot
  accepted_slot TIMESTAMPTZ,
  match_location TEXT,
  -- Used ticket
  ticket_id UUID REFERENCES tickets(id),
  -- Accepted/scheduled info
  accepted_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- MATCH RESULTS TABLE
-- =============================================
CREATE TABLE match_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id),
  winner_team_id UUID REFERENCES teams(id),
  loser_team_id UUID REFERENCES teams(id),
  -- Set scores (challenger perspective)
  set1_challenger INTEGER,
  set1_challenged INTEGER,
  set2_challenger INTEGER,
  set2_challenged INTEGER,
  supertiebreak_challenger INTEGER,
  supertiebreak_challenged INTEGER,
  -- Who reported / who verified
  reported_by_team_id UUID REFERENCES teams(id),
  verified_by_team_id UUID REFERENCES teams(id),
  match_date TIMESTAMPTZ,
  match_location TEXT,
  reported_at TIMESTAMPTZ DEFAULT NOW(),
  verify_deadline TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  auto_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- FREEZE RECORDS TABLE
-- =============================================
CREATE TABLE freeze_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id),
  rank_at_freeze INTEGER NOT NULL,
  tier_id UUID REFERENCES tiers(id),
  frozen_at TIMESTAMPTZ DEFAULT NOW(),
  unfrozen_at TIMESTAMPTZ,
  next_drop_at TIMESTAMPTZ,
  drop_count INTEGER DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- LADDER HISTORY TABLE (audit trail for ladder changes)
-- =============================================
CREATE TABLE ladder_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID REFERENCES seasons(id),
  team_id UUID REFERENCES teams(id),
  old_rank INTEGER,
  new_rank INTEGER,
  change_type TEXT CHECK (change_type IN ('challenge_win', 'challenge_loss', 'forfeit', 'freeze_drop', 'admin_adjustment', 'season_start', 'partner_change', 'dissolved')),
  related_challenge_id UUID REFERENCES challenges(id),
  related_freeze_id UUID REFERENCES freeze_records(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- AUDIT LOG TABLE
-- =============================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES players(id),
  actor_email TEXT,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  notes TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- NOTIFICATION PREFERENCES TABLE
-- =============================================
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE UNIQUE,
  challenge_received_email BOOLEAN DEFAULT TRUE,
  challenge_accepted_email BOOLEAN DEFAULT TRUE,
  match_reminder_email BOOLEAN DEFAULT TRUE,
  result_reported_email BOOLEAN DEFAULT TRUE,
  result_verified_email BOOLEAN DEFAULT TRUE,
  freeze_drop_email BOOLEAN DEFAULT TRUE,
  admin_announcement_email BOOLEAN DEFAULT TRUE,
  challenge_received_app BOOLEAN DEFAULT TRUE,
  challenge_accepted_app BOOLEAN DEFAULT TRUE,
  match_reminder_app BOOLEAN DEFAULT TRUE,
  result_reported_app BOOLEAN DEFAULT TRUE,
  result_verified_app BOOLEAN DEFAULT TRUE,
  freeze_drop_app BOOLEAN DEFAULT TRUE,
  admin_announcement_app BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_challenges_challenging ON challenges(challenging_team_id);
CREATE INDEX idx_challenges_challenged ON challenges(challenged_team_id);
CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_season ON challenges(season_id);
CREATE INDEX idx_ladder_season_rank ON ladder_positions(season_id, rank);
CREATE INDEX idx_teams_season ON teams(season_id);
CREATE INDEX idx_teams_player1 ON teams(player1_id);
CREATE INDEX idx_teams_player2 ON teams(player2_id);
CREATE INDEX idx_notifications_player ON notifications(player_id, is_read);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_ladder_history_team ON ladder_history(team_id, season_id);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE ladder_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE freeze_records ENABLE ROW LEVEL SECURITY;

-- Players can read all players (for ladder display)
CREATE POLICY "Players are viewable by everyone" ON players
  FOR SELECT USING (true);

-- Players can update their own profile
CREATE POLICY "Players can update own profile" ON players
  FOR UPDATE USING (auth.uid()::TEXT = id::TEXT);

-- Teams are viewable by everyone
CREATE POLICY "Teams are viewable by everyone" ON teams
  FOR SELECT USING (true);

-- Ladder positions are viewable by everyone
CREATE POLICY "Ladder positions viewable by everyone" ON ladder_positions
  FOR SELECT USING (true);

-- Challenges are viewable by everyone
CREATE POLICY "Challenges viewable by everyone" ON challenges
  FOR SELECT USING (true);

-- Match results are viewable by everyone
CREATE POLICY "Match results viewable by everyone" ON match_results
  FOR SELECT USING (true);

-- Notifications only viewable by owner
CREATE POLICY "Notifications viewable by owner" ON notifications
  FOR SELECT USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );

-- Notification preferences only viewable/editable by owner
CREATE POLICY "Notification preferences by owner" ON notification_preferences
  FOR ALL USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_ladder_positions_updated_at BEFORE UPDATE ON ladder_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_challenges_updated_at BEFORE UPDATE ON challenges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_freeze_records_updated_at BEFORE UPDATE ON freeze_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- SEED DEFAULT SEASON 3 DATA
-- =============================================
INSERT INTO seasons (name, season_number, start_date, end_date, is_active, status)
VALUES ('Season 3', 3, '2026-01-01', '2026-03-31', TRUE, 'active');

-- Get season id and insert default settings
DO $$
DECLARE
  season_id UUID;
BEGIN
  SELECT id INTO season_id FROM seasons WHERE season_number = 3;

  INSERT INTO league_settings (season_id) VALUES (season_id);

  INSERT INTO tiers (season_id, name, rank_order, color, min_rank, max_rank, prize_1st, prize_2nd)
  VALUES
    (season_id, 'Diamond', 1, '#06B6D4', 1, 4, 60000, 30000),
    (season_id, 'Platinum', 2, '#64748B', 5, 19, 50000, 25000),
    (season_id, 'Gold', 3, '#F59E0B', 20, 34, 40000, 20000),
    (season_id, 'Silver', 4, '#9CA3AF', 35, 49, 30000, 15000),
    (season_id, 'Bronze', 5, '#F97316', 50, NULL, 30000, 15000);
END $$;
