-- Migration 018: Allow players to mark/delete their own notifications
--
-- The original schema only had a FOR SELECT policy on notifications.
-- Players could not UPDATE (mark as read) or DELETE their own rows,
-- causing all dismiss/dismiss-all/delete actions to silently fail.

-- Players can mark their own notifications as read (UPDATE is_read, read_at only)
CREATE POLICY "Players can update own notifications" ON notifications
  FOR UPDATE USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  )
  WITH CHECK (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );

-- Players can delete their own notifications
CREATE POLICY "Players can delete own notifications" ON notifications
  FOR DELETE USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );
