-- Design-only PostgreSQL 15 schema. M4 does not install or migrate this schema.
CREATE TYPE rdf_sync_status AS ENUM ('BOOTSTRAPPING','HEALTHY','CATCHING_UP','STALE','GAP_DETECTED','REBUILD_REQUIRED','REBUILDING','ERROR');
CREATE TABLE rdf_sync_source (
  instance_id uuid PRIMARY KEY REFERENCES wikibase_instance(id), source_identity text UNIQUE NOT NULL,
  status rdf_sync_status NOT NULL, cursor_timestamp timestamptz, cursor_rcid bigint,
  snapshot_start_timestamp timestamptz, snapshot_start_rcid bigint, snapshot_end_timestamp timestamptz,
  snapshot_end_rcid bigint, generation bigint NOT NULL DEFAULT 0, last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((cursor_timestamp IS NULL) = (cursor_rcid IS NULL)), CHECK (cursor_rcid IS NULL OR cursor_rcid >= 0)
);
CREATE TABLE rdf_sync_entity_fence (
  instance_id uuid NOT NULL REFERENCES wikibase_instance(id), entity_id varchar(32) NOT NULL,
  indexed_revision bigint NOT NULL DEFAULT 0, latest_seen_revision bigint NOT NULL DEFAULT 0,
  last_event_timestamp timestamptz, last_event_rcid bigint, graph_iri text NOT NULL,
  graph_checksum char(64), status rdf_sync_status NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(instance_id,entity_id), CHECK(entity_id ~ '^[QP][1-9][0-9]*$'),
  CHECK(indexed_revision >= 0 AND latest_seen_revision >= indexed_revision)
);
CREATE TABLE rdf_sync_attempt (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES wikibase_instance(id), entity_id varchar(32),
  revision bigint, phase text NOT NULL, outcome text NOT NULL, error_code text,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
