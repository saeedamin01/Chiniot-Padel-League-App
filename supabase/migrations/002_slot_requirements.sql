-- Add time slot requirement fields to league_settings
ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS slot_evening_count INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS slot_weekend_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS slot_evening_start_hour INTEGER DEFAULT 18,
  ADD COLUMN IF NOT EXISTS slot_evening_end_hour INTEGER DEFAULT 21;

-- Update existing rows to default values in case they were NULL
UPDATE league_settings
SET
  slot_evening_count = COALESCE(slot_evening_count, 2),
  slot_weekend_count = COALESCE(slot_weekend_count, 1),
  slot_evening_start_hour = COALESCE(slot_evening_start_hour, 18),
  slot_evening_end_hour = COALESCE(slot_evening_end_hour, 21);
