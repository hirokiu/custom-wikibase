CREATE TABLE rdf_query_service (
  query_service_id varchar(64) PRIMARY KEY,
  source_identity text NOT NULL REFERENCES rdf_sync_source(source_identity) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(query_service_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  UNIQUE(query_service_id,source_identity)
);
CREATE TABLE rdf_serving_pointer (
  query_service_id varchar(64) PRIMARY KEY REFERENCES rdf_query_service(query_service_id) ON DELETE CASCADE,
  source_identity text NOT NULL,
  generation_id varchar(64) NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
  previous_generation_id varchar(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(query_service_id,source_identity) REFERENCES rdf_query_service(query_service_id,source_identity) ON DELETE CASCADE,
  FOREIGN KEY(source_identity,generation_id) REFERENCES rdf_generation(source_identity,generation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(source_identity,previous_generation_id) REFERENCES rdf_generation(source_identity,generation_id) DEFERRABLE INITIALLY DEFERRED
);
