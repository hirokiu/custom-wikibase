# K3 Controller integration boundary

Custom Wikibase remains the instance product. A future Controller may own the
desired lifecycle of many instances, but it must integrate through a typed,
versioned driver rather than shelling out arbitrary `kubectl` or accepting raw
Helm values.

The minimum instance registration contract is:

- stable instance UUID, display name, owner/tenant identity, and host/cluster ID;
- namespace and Helm release identity;
- allowlisted product version and profile (`none`, `virtuoso`,
  `fuseki-tdb2`, or `oxigraph`);
- canonical public URL and a separate trusted internal source URL;
- desired lifecycle state and observed workload/PVC/runtime state;
- query capability, logical query endpoint, serving generation, sync state,
  freshness, and last successful reconciliation;
- credential references only, never credential values.

The Kubernetes driver should expose structured operations such as
`observeInstance`, `installInstance`, `startInstance`, `stopInstance`,
`restartInstance`, `requestRebuild`, and `observeOperation`. Identifiers and
profile/version selections are validated against registries. The driver owns
namespace/release derivation and never accepts a namespace, hostname, CLI
fragment, arbitrary manifest, or arbitrary Helm value from the API.

`stopInstance` means scaling the instance's allowlisted active workloads to
zero while preserving PVCs, Secrets, desired configuration, and the stable
UUID. `startInstance` restores the recorded desired replicas and is idempotent.
`restartInstance` performs a bounded rollout without changing desired state.
The Controller must distinguish uninstall from purge: initial APIs should offer
neither deletion nor implicit PVC removal.

Reconciliation compares Registry desired state with Kubernetes observation and
runtime discovery. A mismatch in UUID, namespace/release ownership labels,
profile, credential reference, or source identity is a hard conflict and must
fail closed. Operations are persisted with idempotency keys and optimistic
versioning. Per-instance leases serialize mutations; observation may run in
parallel with bounded cluster-wide concurrency.

K3 should first import the three-instance K2 shape into a disposable Controller
Registry, then prove observation and lifecycle calls without granting the web
application direct Kubernetes access. It should also make source identity and
query-service identity globally unique using the stable instance UUID before
testing a shared Controller PostgreSQL service.
