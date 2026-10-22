-- Recovery review (spec #58, #61): an abandoned operation stays on the
-- Recovery page as Abandoned until the user dismisses its notice on the task.
-- Operations abandoned before this migration count as dismissed.
ALTER TABLE operations ADD COLUMN dismissed_at TEXT;
UPDATE operations SET dismissed_at = completed_at WHERE state = 'abandoned';
