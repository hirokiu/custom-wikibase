ALTER TABLE rdf_generation_retirement
  ADD COLUMN deletion_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CHECK(jsonb_typeof(deletion_evidence)='object');

COMMENT ON COLUMN rdf_generation_retirement.deletion_evidence IS
  'Per-role structured DELETE_INTENT/DELETED evidence bound to this cleanup operation; never credentials or raw Kubernetes objects.';
