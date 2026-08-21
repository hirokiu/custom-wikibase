# Japan Wikibase M10C qualification record

Date: 2026-08-20

## Decision

Overall classification remains `INSUFFICIENT_EVIDENCE`.

The Virtuoso path now uses the packaged Kubernetes Generation Coordinator for
candidate creation and promotion. The qualification harness no longer requires
or checks a public generation identifier header and no longer performs the
serving-pointer CAS directly. Complete M10C qualification has not yet passed.

## Implemented contract repair

- Generation B is requested through an idempotent durable coordinator operation.
- Two packaged Coordinator replicas perform generation creation, lease/fence
  ownership, promotion journal creation, pointer CAS, Router convergence and
  rollback protection.
- Router identity is checked through the durable pointer version and controlled
  RDF values. Internal generation topology is not added to the public response.
- Generation A is deliberately held at an old controlled value while B catches
  up to a new controlled value for continuous visibility measurement.
- The final comparison path takes a fresh Wikibase dump after promotion and a
  real post-promotion edit and requires missing `0` / extra `0`.
- A precondition check makes the B harness reject execution unless a qualified
  Virtuoso generation A is currently `SERVING`.

The concurrent initial-install path also exposed a real runtime defect: the
entrypoint kept the installation lock file descriptor open across `exec`. The
descriptor is now explicitly unlocked and closed before starting MediaWiki or
the Job Runner.

## Executed evidence

Four clean disposable-cluster attempts were made. Every attempt used only
`k3d-wfp-jwb-m10` and `/tmp/wfp-jwb-m10-kubeconfig.yaml`.

Confirmed repeatedly:

- ARM64 real Japan Wikibase source
- Q1-Q3 and P1-P7 fixture creation
- MediaWiki and MariaDB Pod recreation with stable PVC UIDs
- 64,509-byte canonical RDF source snapshot
- Generation A bootstrap and incremental synchronization
- Generation A canonical equality: missing `0`, extra `0`
- Two packaged Coordinator replicas
- Coordinator-created independent Generation B and PVC
- Generation B real catch-up, including Property and delete/undelete events
- Generation B pre-promotion canonical equality: missing `0`, extra `0`
- durable coordinator operation reached `VALIDATING`
- an earlier run reached Coordinator pointer CAS before the visibility harness
  rejected its own late sampling

The last clean run did not reach promotion because the visibility query used a
named-graph clause while the Router intentionally exposes the registered named
graphs as the logical default dataset. That measurement query has been repaired,
but a complete clean rerun has not been executed after the final repair.

## Not qualified / skipped

- complete `OLD_COMPLETE* NEW_COMPLETE*` evidence
- exact connection-error count for a successful promotion
- final post-promotion canonical equality in the packaged Coordinator run
- Source Reader and Worker hard deletion and rolling-update matrix
- Router, Coordinator, Wikibase and Job Runner rolling-update matrix
- MariaDB and PostgreSQL full restart/outage matrix
- serving/candidate Virtuoso restart matrix
- discovery and ownership live failure matrix
- wrong-label mutation rejection live matrix
- missing-PVC live qualification
- packaged integrated retirement and retirement-crash recovery
- NetworkPolicy enforcement matrix (k3d CNI enforcement is also unproven)
- integrated resource and latency measurements
- second successful reproducibility run
- Oxigraph end-to-end qualification
- Fuseki/TDB2 end-to-end qualification
- Virtuoso-to-Oxigraph Kubernetes migration

These skips are mandatory M10C gates. Therefore Virtuoso, M10 overall, and the
cross-backend classifications must not be upgraded.

## Current classifications

| Scope | Classification |
| --- | --- |
| Virtuoso | `QUALIFIED_LOCAL_KUBERNETES_DURABLE_SYNC_WITH_LIMITATIONS` |
| Oxigraph | `INSUFFICIENT_EVIDENCE` |
| Fuseki/TDB2 | `INSUFFICIENT_EVIDENCE` |
| Virtuoso to Oxigraph migration | `INSUFFICIENT_EVIDENCE` |
| M10 overall | `INSUFFICIENT_EVIDENCE` |

Backend roles are unchanged: Virtuoso remains the default candidate, Fuseki/TDB2
the reference backend, Oxigraph the lightweight backend, and Blazegraph/WDQS the
Wikibase Suite compatibility backend.

## Next execution boundary

First rerun the repaired Virtuoso sequence from a clean cluster and retain the
successful visibility samples and durable journal. Only then implement and run
the restart/failure/retirement matrices. Oxigraph, Fuseki and cross-backend
migration remain gated on complete Virtuoso qualification. M11 must not start.

## M10C-Final run update

Fresh run identifier: `1787196997988`; promotion operation:
`e54f2ceb-4433-49bd-886d-921ea4c8824e`.

The repaired Virtuoso visibility and promotion path passed:

- pointer `gen-a` version 1 to `gen-b` version 2 exactly once
- journal `COMMITTED / GENERATION_FINALIZED`
- `OLD_COMPLETE=1`, `NEW_COMPLETE=36`
- `EMPTY=0`, `PARTIAL=0`, `INVALID=0`, `CONNECTION_ERROR=0`
- B pre-promotion and immediate post-promotion equality both missing 0 / extra 0
- post-promotion edits reached rcid 18, then rcid 19 after Reader/Worker
  recreation and rcid 20 after database/backend recreation
- B entity fence remained `CURRENT` through revision 18

Hard Pod recreation passed for Source Reader, B Worker, MariaDB, Controller
PostgreSQL and serving Virtuoso. MariaDB, PostgreSQL and Virtuoso PVC UIDs were
unchanged. Harmless rollouts passed for Reader, Worker, Router (two replicas),
Coordinator (two replicas), Wikibase and Job Runner. The install-lock fix was
included in image `sha256:b8da41b3ce7952b771ae7f93f147b02c39e480fb5e28d22f7f4807f226ba7da4`;
concurrent initial startup and later Job Runner rollout completed without the
old deadlock.

Observed steady-state resource values included MediaWiki 132m/113Mi, Job Runner
1m/28Mi, MariaDB 26m/126Mi, PostgreSQL 28m/34Mi, Source Reader 11m/43Mi,
B Worker 16m/68Mi, Routers 3m/25-28Mi each, Coordinators 5-6m/59-60Mi each,
and serving Virtuoso 2m/106Mi. Generation and PostgreSQL PVC requests were
512Mi; MariaDB was 1Gi. These are single local observations, not sizing advice.

The overall classification nevertheless remains
`QUALIFIED_LOCAL_KUBERNETES_DURABLE_SYNC_WITH_LIMITATIONS`: active PostgreSQL
outage, candidate C, live discovery/wrong-label/missing-PVC matrices, packaged
integrated retirement and retirement-crash recovery, enforced NetworkPolicy
matrix, a second successful critical run, and the secondary backends were not
completed. The final equality immediately after promotion passed, but a fresh
full canonical comparison after the entire restart matrix was not executed.
