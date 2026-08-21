ALTER TABLE rdf_generation
  ADD COLUMN protection_state text NOT NULL DEFAULT 'NONE'
    CHECK(protection_state IN('NONE','SERVING','ROLLBACK','PROMOTION_IN_PROGRESS','RETIREMENT_IN_PROGRESS')),
  ADD COLUMN lifecycle_version bigint NOT NULL DEFAULT 1 CHECK(lifecycle_version > 0);

UPDATE rdf_generation SET protection_state='SERVING' WHERE state='SERVING';
UPDATE rdf_generation g SET protection_state='ROLLBACK'
FROM rdf_serving_pointer p
WHERE p.source_identity=g.source_identity AND p.previous_generation_id=g.generation_id;

CREATE UNIQUE INDEX rdf_generation_one_rollback_protection
  ON rdf_generation(source_identity) WHERE protection_state='ROLLBACK';

CREATE TABLE rdf_rollback_protection_release (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  source_identity text NOT NULL,
  query_service_id varchar(64) NOT NULL,
  generation_id varchar(64) NOT NULL,
  expected_serving_generation_id varchar(64) NOT NULL,
  expected_pointer_version bigint NOT NULL CHECK(expected_pointer_version > 0),
  resulting_pointer_version bigint NOT NULL CHECK(resulting_pointer_version > 0),
  resulting_generation_version bigint NOT NULL CHECK(resulting_generation_version > 0),
  operation_fence bigint NOT NULL CHECK(operation_fence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id),
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation(source_identity,generation_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_identity,expected_serving_generation_id) REFERENCES rdf_generation(source_identity,generation_id) ON DELETE RESTRICT,
  FOREIGN KEY(query_service_id,source_identity) REFERENCES rdf_query_service(query_service_id,source_identity) ON DELETE RESTRICT
);

ALTER TABLE rdf_generation_retirement
  ADD COLUMN expected_pointer_version bigint CHECK(expected_pointer_version IS NULL OR expected_pointer_version > 0),
  ADD COLUMN expected_generation_version bigint CHECK(expected_generation_version IS NULL OR expected_generation_version > 0),
  ADD COLUMN operation_fence bigint NOT NULL DEFAULT 0 CHECK(operation_fence >= 0),
  ADD COLUMN deletion_token uuid,
  ADD COLUMN deletion_progress jsonb NOT NULL DEFAULT '{"workload":false,"service":false,"pvc":false}'::jsonb;
