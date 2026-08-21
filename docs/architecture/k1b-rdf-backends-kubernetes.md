# K1B RDF backends on standalone Kubernetes

K1B extends the K1A single-instance Helm deployment without changing the
product semantics. `profile` is an allowlisted product choice: `none`,
`virtuoso`, `fuseki-tdb2`, or `oxigraph`. A query-enabled release deploys one
backend family, never all families together.

```text
Wikibase -> common Snapshot Producer -> common normalization/partitioning
                                      -> Worker A/B -> Backend A/B
                                                     ^
                                      Query Router --+ (serving slot only)
```

PostgreSQL migration 005--013, bootstrap, Source Reader, Snapshot Producer,
workers, and Query Router are common. Only the physical backend image, internal
port/path, data mount, and backend capability adapter vary. Fuseki/TDB2 uses
`/fuseki/databases` and `/jwb/*`; Oxigraph uses `/data` and its
`/query`, `/update`, and `/store` endpoints. Virtuoso compatibility is
unchanged. Backend Services are headless and Query Router remains the only
logical SPARQL boundary.

Each A/B StatefulSet has an independent `ReadWriteOnce` PVC classified as
derived and rebuildable. Snapshot artifacts use a separate bounded temporary
PVC only when a qualification/rebuild Job is enabled. They are non-authoritative,
are retained with that PVC after a successful run, and are deleted with the PVC
when the disposable release is destroyed. K1B does not add automatic artifact
GC; the release operator owns cleanup and must size `storage.snapshots`.

The persisted runtime identifier remains `compose` and application configuration
remains `standalone-compose` for compatibility with the existing fixed-service
contract. A future migration should introduce backend-neutral `standalone` plus
an orthogonal deployment target (`compose` or `kubernetes`) without rewriting
stored identifiers in place.

The bounded snapshot/coordinator Jobs remain opt-in chart resources for K1B.
They are qualification tooling, not required long-running product components.
A later change should move them to a dedicated external harness or Helm test
hooks so running qualification does not increment normal release revisions.

NetworkPolicy manifests remain enabled by default, but standard k3d/k3s does
not establish enforcement evidence. The status remains
`NETWORK_POLICY_NOT_QUALIFIED_IN_K3D` pending a separate K1C lane with a
NetworkPolicy-capable CNI.
