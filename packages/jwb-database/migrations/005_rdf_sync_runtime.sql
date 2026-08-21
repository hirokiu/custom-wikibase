CREATE TYPE rdf_sync_status AS ENUM ('BOOTSTRAPPING','HEALTHY','CATCHING_UP','STALE','GAP_DETECTED','REBUILD_REQUIRED','REBUILDING','ERROR');
CREATE TYPE rdf_entity_sync_status AS ENUM ('CURRENT','PENDING','FAILED','GAP','DELETED','REDIRECT');
CREATE TABLE rdf_sync_source (
  source_identity text PRIMARY KEY,
  instance_id uuid NOT NULL,
  backend_type text NOT NULL,
  cursor_timestamp timestamptz,
  cursor_rcid bigint,
  status rdf_sync_status NOT NULL DEFAULT 'BOOTSTRAPPING',
  last_poll_at timestamptz,
  last_success_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((cursor_timestamp IS NULL) = (cursor_rcid IS NULL)),
  CHECK (cursor_rcid IS NULL OR cursor_rcid >= 0)
);
CREATE TABLE rdf_sync_entity (
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  entity_id varchar(32) NOT NULL,
  indexed_revision bigint NOT NULL DEFAULT 0,
  latest_seen_revision bigint NOT NULL DEFAULT 0,
  status rdf_entity_sync_status NOT NULL DEFAULT 'PENDING',
  graph_checksum char(64),
  last_success_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_identity,entity_id),
  CHECK(entity_id ~ '^[QP][1-9][0-9]*$'),
  CHECK(indexed_revision >= 0 AND latest_seen_revision >= indexed_revision)
);
CREATE TABLE rdf_sync_rebuild (
  id uuid PRIMARY KEY,
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  backend_type text NOT NULL,
  generation bigint NOT NULL,
  state rdf_sync_status NOT NULL,
  start_timestamp timestamptz NOT NULL,
  start_rcid bigint NOT NULL,
  end_timestamp timestamptz,
  end_rcid bigint,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  UNIQUE(source_identity,generation)
);
CREATE INDEX rdf_sync_entity_status_idx ON rdf_sync_entity(source_identity,status);
CREATE INDEX rdf_sync_rebuild_state_idx ON rdf_sync_rebuild(source_identity,state);
