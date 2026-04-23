-- Migration 020: Add slot_evening_start_minute to support sub-hour evening starts (e.g. 5:30 PM)

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS slot_evening_start_minute INTEGER DEFAULT 30;

-- Update existing rows: shift start to 17:30 (was 18:00)
UPDATE league_settings
  SET slot_evening_start_hour   = 17,
      slot_evening_start_minute = 30
  WHERE slot_evening_start_hour = 18
    AND (slot_evening_start_minute IS NULL OR slot_evening_start_minute = 0);
