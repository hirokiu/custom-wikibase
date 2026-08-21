# ADR-0035: Japan Wikibase is an independently operable product

Status: accepted for J1 boundary preparation

## Decision

Japan Wikibase is an independently operable distribution. It owns MediaWiki,
Wikibase Repository, MariaDB, the Job Runner, Japanese defaults, uploads and
runtime persistence, RDF snapshot and RecentChanges ingestion, revision
fencing, RDF normalization, partitioning and canonicalization, the RDF Sync
Worker, Query Router, internal serving pointer and generation lifecycle, and
the Virtuoso, Fuseki/TDB2 and Oxigraph profiles. It also owns its Docker
Compose distribution and standalone Kubernetes/Helm package.

The Federated Wikibase Platform owns users and owners, authentication and
authorization, host and instance registries, Controller API/UI, provisioning,
placement, multi-instance orchestration, instance Start/Stop/Restart,
platform reconciliation and observation, platform RBAC, Wikibase Suite/WDQS
compatibility and management of the existing workshop instances.

The Japan Wikibase RDF-generation lifecycle is not the Federated Platform
instance lifecycle. The Platform installs and observes a pinned Japan
Wikibase release as one instance. It does not operate internal RDF generation
StatefulSets, PVCs, serving pointers, update endpoints or journals.

Integration is through versioned release artifacts and the read-only
`jwb-runtime-v1` contract. Neither product imports the other product's runtime
source. Japan Wikibase must run without a Controller and, in the core-only
profile, without PostgreSQL or a query backend.

## v0.1 policy

The allowlisted backend values are `none`, `virtuoso`, `fuseki-tdb2` and
`oxigraph`. Virtuoso is the default query backend, Fuseki/TDB2 is the reference
backend, Oxigraph is the lightweight backend, and `none` disables the query
subsystem. Blazegraph/WDQS remains a Platform compatibility runtime.

Automatic physical deletion of retired RDF generations is not enabled by
default in v0.1. A replaced generation is logically retired, retained, and
removed only by explicit administrator maintenance. Existing fenced retirement
code and tests remain intact for a later safety-qualified feature.

## Kubernetes boundary

Japan Wikibase owns internal workload grouping, MariaDB and query-subsystem
storage, Job Runner topology, readiness/liveness, graceful shutdown and the
standalone chart. The Platform owns release installation, instance ownership,
placement, instance-level lifecycle and cross-instance observation. Internal
Pod and PVC names are not an integration API.

## Consequences

- J1 defines and tests the boundary without moving files.
- The future staging prefix is `components/japan-wikibase/`.
- A shared npm source package is deliberately not introduced.
- Repository extraction follows standalone Compose and Kubernetes qualification.
