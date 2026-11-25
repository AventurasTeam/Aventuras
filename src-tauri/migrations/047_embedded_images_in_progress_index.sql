-- Only unfinished rows are ever looked up by status, and there are few of them at a time.
DROP INDEX IF EXISTS idx_embedded_images_status;
CREATE INDEX idx_embedded_images_in_progress ON embedded_images(status) WHERE status IN ('pending', 'generating');
