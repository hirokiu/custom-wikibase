CREATE TABLE rdf_coordinator_operation (
  id uuid PRIMARY KEY,
  request_key varchar(128) NOT NULL UNIQUE,
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  query_service_id varchar(64) NOT NULL REFERENCES rdf_query_service(query_service_id) ON DELETE CASCADE,
  candidate_generation_id varchar(64) NOT NULL,
  backend_type text NOT NULL CHECK(backend_type IN('virtuoso','oxigraph','fuseki-tdb2')),
  normalization_model text NOT NULL CHECK(normalization_model='jwb-rdf-normalization-v1'),
  partition_model text NOT NULL CHECK(partition_model='jwb-partition-v1'),
  requested_reason text NOT NULL CHECK(requested_reason IN('MANUAL_LOCAL_QUALIFICATION','REVISION_GAP','SCHEMA_STALE','BACKEND_RECOVERY')),
  state text NOT NULL CHECK(state IN('REBUILD_REQUESTED','CREATING_GENERATION','LOADING_SNAPSHOT','WAITING_FOR_CATCHUP','VALIDATING','READY_TO_PROMOTE','PROMOTING','PROMOTED','RETIRING_OLD','ROLLBACK_PROTECTED','CLEANING_UP','COMPLETED','FAILED','AMBIGUOUS')),
  expected_generation_id varchar(64),
  expected_pointer_version bigint CHECK(expected_pointer_version IS NULL OR expected_pointer_version > 0),
  snapshot_cursor_timestamp timestamptz,
  snapshot_cursor_rcid bigint CHECK(snapshot_cursor_rcid IS NULL OR snapshot_cursor_rcid >= 0),
  target_cursor_timestamp timestamptz,
  target_cursor_rcid bigint CHECK(target_cursor_rcid IS NULL OR target_cursor_rcid >= 0),
  claimed_by uuid,
  lease_expires_at timestamptz,
  fence bigint NOT NULL DEFAULT 0 CHECK(fence >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((snapshot_cursor_timestamp IS NULL)=(snapshot_cursor_rcid IS NULL)),
  CHECK((target_cursor_timestamp IS NULL)=(target_cursor_rcid IS NULL)),
  CHECK((claimed_by IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX rdf_coordinator_operation_claim_idx ON rdf_coordinator_operation(state,lease_expires_at);

ALTER TABLE rdf_generation_promotion
  ADD COLUMN operation_id uuid REFERENCES rdf_coordinator_operation(id) ON DELETE RESTRICT,
  ADD COLUMN phase text NOT NULL DEFAULT 'GENERATION_FINALIZED'
    CHECK(phase IN('PREPARING','POINTER_UPDATED','ROUTER_VERIFIED','GENERATION_FINALIZED')),
  ADD COLUMN expected_pointer_version bigint CHECK(expected_pointer_version IS NULL OR expected_pointer_version > 0),
  ADD COLUMN resulting_pointer_version bigint CHECK(resulting_pointer_version IS NULL OR resulting_pointer_version > 0),
  ADD COLUMN router_verified_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE rdf_generation_retirement (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES rdf_coordinator_operation(id) ON DELETE RESTRICT,
  source_identity text NOT NULL,
  generation_id varchar(64) NOT NULL,
  state text NOT NULL CHECK(state IN('ROLLBACK_PROTECTED','RETIRING','RETIRED','PHYSICAL_DELETE_PENDING','PHYSICALLY_DELETED','METADATA_FINALIZED','FAILED','AMBIGUOUS')),
  physical_delete_attempted_at timestamptz,
  physical_deleted_at timestamptz,
  finalized_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_identity,generation_id),
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation(source_identity,generation_id) ON DELETE RESTRICT
);
