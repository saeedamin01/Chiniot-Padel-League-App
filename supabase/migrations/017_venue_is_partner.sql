-- Migration 017: Add is_partner flag to venues
--
-- Partner venues are clubs or courts that have a formal arrangement with CPL
-- (e.g. a discount for league members). They appear in a separate "Partner
-- Venues" section in the venue picker and are highlighted for players.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false;

-- Partners sort before non-partners, then alphabetically
CREATE INDEX IF NOT EXISTS idx_venues_partner
  ON venues (season_id, is_partner DESC, name);

COMMENT ON COLUMN venues.is_partner IS
  'True for clubs/courts with a formal CPL partnership (discounts etc.)';
