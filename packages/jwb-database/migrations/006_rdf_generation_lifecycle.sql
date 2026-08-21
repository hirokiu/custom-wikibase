CREATE TYPE rdf_generation_state AS ENUM ('CREATING','LOADING','CATCHING_UP','VALIDATING','READY','SERVING','RETIRING','RETIRED','FAILED');
CREATE TYPE rdf_generation_validation_state AS ENUM ('PENDING','VALID','INVALID');
CREATE TABLE rdf_generation (
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  generation_id varchar(64) NOT NULL,
  backend_type text NOT NULL,
  state rdf_generation_state NOT NULL,
  source_snapshot_timestamp timestamptz NOT NULL,
  source_snapshot_rcid bigint NOT NULL CHECK(source_snapshot_rcid >= 0),
  catchup_timestamp timestamptz,
  catchup_rcid bigint CHECK(catchup_rcid IS NULL OR catchup_rcid >= 0),
  validation_status rdf_generation_validation_state NOT NULL DEFAULT 'PENDING',
  validation_checksum char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  retired_at timestamptz,
  error_code text,
  PRIMARY KEY(source_identity,generation_id),
  CHECK(generation_id ~ '^gen-[a-z0-9][a-z0-9-]{0,58}$'),
  CHECK((catchup_timestamp IS NULL) = (catchup_rcid IS NULL)),
  CHECK((validation_status <> 'VALID') OR validation_checksum IS NOT NULL),
  CHECK((state <> 'SERVING') OR (validation_status = 'VALID' AND promoted_at IS NOT NULL))
);
CREATE UNIQUE INDEX rdf_generation_one_serving ON rdf_generation(source_identity) WHERE state='SERVING';
CREATE TABLE rdf_generation_promotion (
  id uuid PRIMARY KEY,
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  from_generation_id varchar(64),
  to_generation_id varchar(64) NOT NULL,
  state text NOT NULL CHECK(state IN('PREPARING','COMMITTED','ROLLED_BACK','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  FOREIGN KEY(source_identity,to_generation_id) REFERENCES rdf_generation(source_identity,generation_id),
  FOREIGN KEY(source_identity,from_generation_id) REFERENCES rdf_generation(source_identity,generation_id)
);
