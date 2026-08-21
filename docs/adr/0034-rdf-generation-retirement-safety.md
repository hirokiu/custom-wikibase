# ADR-0034: RDF generation retirement requires durable protection and fenced deletion

Status: accepted for local implementation

## Decision

Generation lifecycle and destructive protection are independent PostgreSQL
facts. A generation has a lifecycle state and one of `NONE`, `SERVING`,
`ROLLBACK`, `PROMOTION_IN_PROGRESS`, or `RETIREMENT_IN_PROGRESS`. PostgreSQL
enforces at most one rollback-protected generation per source; the existing
generation-state index enforces one serving generation.

Promotion rotates protection transactionally: the new generation is serving,
the old serving generation is rollback-protected, and an older rollback
generation is released. An operator may instead call the dedicated rollback
release operation. That operation verifies the expected serving generation,
rollback generation, serving-pointer version, promotion/retirement journals,
and generation version in one transaction. It clears the previous pointer,
advances versions, and writes an immutable idempotency record. There is no
generic protection toggle.

Cleanup uses the same structured eligibility evaluator at schedule time and
again in a short transaction immediately before physical deletion. The second
decision is bound to Coordinator owner, lease/fence, generation version,
pointer version, and a new deletion token. PostgreSQL is not held open while
Kubernetes is contacted. A changed pointer, lifecycle version, journal, lease,
or fence rejects deletion.

The Kubernetes driver derives its fixed StatefulSet, Service, and PVC targets.
It reads and validates every target before mutation, then re-reads all present
targets and compares ownership labels, UID, and resourceVersion before the
first delete. Each delete carries UID/resourceVersion preconditions. The fixed
order is workload, Service, then PVC: query traffic and writers disappear
before durable storage. This ordering is not physically transactional. Each
successful or already-absent resource is journaled; partial API failure remains
`PHYSICAL_DELETE_PENDING` and is safely rediscovered on retry.

Before each Kubernetes delete, the Coordinator durably records a structured
`DELETE_INTENT` containing cleanup operation ID, resource role, UID and
resourceVersion. A later 404 is `RESOURCE_ALREADY_DELETED_BY_OPERATION` only
when that same retirement journal contains `DELETE_INTENT` or `DELETED` for
the exact UID. Absence without this evidence is
`RESOURCE_MISSING_UNEXPECTED` and aborts before any remaining mutation. This
also covers a crash after Kubernetes accepts deletion but before the success
marker is persisted; a matching terminating object is the same boundary.

## Migration behavior

Migration 011 derives `SERVING` only from the constrained serving lifecycle
state and derives `ROLLBACK` only from the durable serving pointer's previous
generation. All other rows default to `NONE`. Ambiguous state is not inferred
from logs or Kubernetes. A row that cannot satisfy these constraints fails the
migration rather than weakening protection.

## Consequences

- Ownership or preflight identity mismatch causes zero Kubernetes mutation.
- An API outage after deletion starts can cause partial absence, but cannot be
  reported as metadata-finalized until the fenced journal confirms all work.
- A crash before, during, or after physical deletion retries from durable
  evidence and never recreates generation storage.
- M10D qualification remains a separate explicit action.
