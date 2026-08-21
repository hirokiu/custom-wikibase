ALTER TABLE rdf_sync_source
  ADD COLUMN ingestion_cursor_timestamp timestamptz,
  ADD COLUMN ingestion_cursor_rcid bigint,
  ADD COLUMN legacy_state_resolution text NOT NULL DEFAULT 'UNREVIEWED'
    CHECK(legacy_state_resolution IN('UNREVIEWED','EMPTY_CONFIRMED','MIGRATED')),
  ADD CHECK((ingestion_cursor_timestamp IS NULL)=(ingestion_cursor_rcid IS NULL)),
  ADD CHECK(ingestion_cursor_rcid IS NULL OR ingestion_cursor_rcid >= 0);

-- Existing cursor/entity rows are deliberately not reinterpreted as generation
-- state. A caller must explicitly resolve legacy state before using ingestion.
UPDATE rdf_sync_source SET legacy_state_resolution='EMPTY_CONFIRMED'
WHERE cursor_timestamp IS NULL
  AND NOT EXISTS(SELECT 1 FROM rdf_sync_entity e WHERE e.source_identity=rdf_sync_source.source_identity);

CREATE TYPE rdf_generation_sync_state AS ENUM ('BOOTSTRAPPING','CATCHING_UP','CURRENT','STALE','GAP_DETECTED','ERROR');
CREATE TYPE rdf_generation_schema_state AS ENUM ('PENDING','CURRENT','STALE','ERROR');

CREATE TABLE rdf_generation_sync (
  source_identity text NOT NULL,
  generation_id varchar(64) NOT NULL,
  snapshot_cursor_timestamp timestamptz NOT NULL,
  snapshot_cursor_rcid bigint NOT NULL CHECK(snapshot_cursor_rcid >= 0),
  catchup_cursor_timestamp timestamptz,
  catchup_cursor_rcid bigint CHECK(catchup_cursor_rcid IS NULL OR catchup_cursor_rcid >= 0),
  state rdf_generation_sync_state NOT NULL DEFAULT 'BOOTSTRAPPING',
  schema_state rdf_generation_schema_state NOT NULL DEFAULT 'PENDING',
  last_success_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_identity,generation_id),
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation(source_identity,generation_id) ON DELETE RESTRICT,
  CHECK((catchup_cursor_timestamp IS NULL)=(catchup_cursor_rcid IS NULL))
);

CREATE TABLE rdf_generation_entity_revision (
  source_identity text NOT NULL,
  generation_id varchar(64) NOT NULL,
  entity_id varchar(32) NOT NULL,
  indexed_revision bigint NOT NULL DEFAULT 0 CHECK(indexed_revision >= 0),
  latest_seen_revision bigint NOT NULL DEFAULT 0 CHECK(latest_seen_revision >= indexed_revision),
  state rdf_entity_sync_status NOT NULL DEFAULT 'PENDING',
  graph_checksum char(64),
  last_success_at timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_identity,generation_id,entity_id),
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation_sync(source_identity,generation_id) ON DELETE RESTRICT,
  CHECK(entity_id ~ '^[QP][1-9][0-9]*$')
);

CREATE TABLE rdf_generation_graph (
  source_identity text NOT NULL,
  generation_id varchar(64) NOT NULL,
  graph_iri text NOT NULL,
  partition_kind text NOT NULL CHECK(partition_kind IN('ENTITY','PROPERTY_SCHEMA','GLOBAL')),
  entity_id varchar(32),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_identity,generation_id,graph_iri),
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation_sync(source_identity,generation_id) ON DELETE RESTRICT,
  CHECK(graph_iri ~ '^urn:jwb:(entity:[QP][1-9][0-9]*|schema:P[1-9][0-9]*|global)$'),
  CHECK((partition_kind='GLOBAL' AND entity_id IS NULL AND graph_iri='urn:jwb:global') OR
        (partition_kind='ENTITY' AND entity_id ~ '^[QP][1-9][0-9]*$' AND graph_iri='urn:jwb:entity:'||entity_id) OR
        (partition_kind='PROPERTY_SCHEMA' AND entity_id ~ '^P[1-9][0-9]*$' AND graph_iri='urn:jwb:schema:'||entity_id))
);

CREATE INDEX rdf_generation_entity_revision_state_idx
  ON rdf_generation_entity_revision(source_identity,generation_id,state);
