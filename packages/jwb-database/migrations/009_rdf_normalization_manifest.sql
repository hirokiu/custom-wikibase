ALTER TYPE rdf_entity_sync_status ADD VALUE IF NOT EXISTS 'RESTORING';

ALTER TABLE rdf_generation
  ADD COLUMN normalization_model text,
  ADD COLUMN partition_model text NOT NULL DEFAULT 'jwb-partition-v1',
  ADD COLUMN generation_manifest jsonb,
  ADD CHECK(normalization_model IS NULL OR normalization_model='jwb-rdf-normalization-v1'),
  ADD CHECK(partition_model='jwb-partition-v1'),
  ADD CHECK(generation_manifest IS NULL OR jsonb_typeof(generation_manifest)='object');

-- NULL is intentional for legacy generations. They must be rebuilt and may
-- not be promoted under the M9C contract.
