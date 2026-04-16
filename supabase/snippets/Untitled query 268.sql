ALTER TABLE challenges ADD COLUMN IF NOT EXISTS proposed_slot TIMESTAMPTZ;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS proposed_location TEXT;
LTER TABLE challenges ADD COLUMN IF NOT EXISTS match_date TIMESTAMPTZ;ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check CHECK (status IN ('pending', 'revision_proposed', 'scheduled', 'played', 'forfeited', 'dissolved'));