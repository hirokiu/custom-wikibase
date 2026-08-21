ALTER TABLE rdf_generation
  ADD COLUMN runtime_type text CHECK(runtime_type IN('kubernetes','compose')),
  ADD COLUMN runtime_namespace varchar(63)
    CHECK(runtime_namespace ~ '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$');

ALTER TABLE rdf_coordinator_operation
  ADD COLUMN operation_type text
    CHECK(operation_type IN('PROMOTION','ROLLBACK_RELEASE','RETIREMENT')),
  ADD COLUMN owner_pod_uid uuid;
ALTER TABLE rdf_coordinator_operation DROP CONSTRAINT rdf_coordinator_operation_state_check;
ALTER TABLE rdf_coordinator_operation ADD CHECK(state IN(
  'REBUILD_REQUESTED','CREATING_GENERATION','LOADING_SNAPSHOT','WAITING_FOR_CATCHUP','VALIDATING',
  'READY_TO_PROMOTE','PROMOTING','PROMOTED','RETIRING_OLD','ROLLBACK_PROTECTED',
  'RETIREMENT_WAITING_ELIGIBILITY','CLEANING_UP','COMPLETED','FAILED','AMBIGUOUS'
));

ALTER TABLE rdf_generation_retirement DROP CONSTRAINT rdf_generation_retirement_state_check;
ALTER TABLE rdf_generation_retirement ADD CHECK(state IN(
  'REQUESTED','WAITING_ELIGIBILITY','ELIGIBLE','SCHEDULED','RETIRING','LOGICALLY_RETIRED',
  'PHYSICAL_DELETE_PENDING','PHYSICALLY_DELETED','METADATA_FINALIZED','FAILED','AMBIGUOUS'
));
ALTER TABLE rdf_generation_retirement
  ADD COLUMN eligibility_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_eligibility_checked_at timestamptz;

CREATE TABLE rdf_generation_delete_attempt (
  id uuid PRIMARY KEY,
  cleanup_operation_id uuid NOT NULL REFERENCES rdf_coordinator_operation(id) ON DELETE RESTRICT,
  generation_id varchar(64) NOT NULL,
  operation_fence bigint NOT NULL CHECK(operation_fence > 0),
  deletion_token uuid NOT NULL,
  resource_role text NOT NULL CHECK(resource_role IN('workload','service','pvc')),
  namespace varchar(63) NOT NULL,
  resource_name varchar(253) NOT NULL,
  expected_uid uuid NOT NULL,
  expected_resource_version varchar(64) NOT NULL,
  attempt_state text NOT NULL CHECK(attempt_state IN('PLANNED','FENCE_MARKED','DELETE_INTENT','DELETE_ACCEPTED','ABSENT_CONFIRMED','FAILED')),
  delete_intent_at timestamptz,
  delete_accepted_at timestamptz,
  absence_confirmed_at timestamptz,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cleanup_operation_id,operation_fence,deletion_token,resource_role)
);
CREATE INDEX rdf_generation_delete_attempt_operation_idx
  ON rdf_generation_delete_attempt(cleanup_operation_id,operation_fence,deletion_token);

CREATE TABLE rdf_generation_protection_audit (
  id uuid PRIMARY KEY,
  promotion_operation_id uuid NOT NULL REFERENCES rdf_coordinator_operation(id) ON DELETE RESTRICT,
  source_identity text NOT NULL,
  released_generation_id varchar(64),
  rollback_generation_id varchar(64),
  serving_generation_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE rdf_generation_delete_attempt IS
  'Immutable fenced resource identity plus monotonic delete lifecycle; DELETE_ACCEPTED is not absence confirmation.';
