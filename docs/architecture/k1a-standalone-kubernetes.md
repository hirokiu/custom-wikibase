# K1A standalone Kubernetes architecture

K1A maps the standalone Custom Wikibase product to one namespace and one Helm
release. It is independent of the Federated Wikibase Platform and supports one
instance only. The supported profiles are Core-only (`none`) and Virtuoso with
fixed `gen-a`/`gen-b` slots.

```text
                    externally reachable
                  +-----------------------+
                  | Wikibase   QueryRouter|
                  +-----+----------+------+
                        |          |
 MariaDB PVC <- MariaDB <- MediaWiki      +-> serving Virtuoso A/B
 uploads PVC <----------+  + Job Runner   |      (derived PVCs)
 runtime PVC <----------+                 |
                                           +-> JWB PostgreSQL
                                               (query-control PVC)
                            Source Reader ------^       ^
                            Worker A/B ----------+-------+
```

MediaWiki/Wikibase, MariaDB, uploads, and the stable instance UUID/runtime state
are authoritative. PostgreSQL stores query-control state. Virtuoso generations
are derived and rebuildable. Query Router is the only public SPARQL boundary;
Virtuoso query/update/admin ports stay internal.

For the Virtuoso profile, PostgreSQL readiness precedes a finite Migration Job.
The Bootstrap Job polls migration status with a bounded init container and then
runs once. Source Reader, Worker A/B, and Query Router use a bounded bootstrap
gate. SQL/schema/checksum failures are not retried by the migration Job
(`backoffLimit: 0`), and completed Job logs remain available for diagnosis.

K1A retains the standalone runtime identifier because the current application
contract deliberately allowlists fixed service DNS (`wikibase`,
`jwb-postgresql`, `backend-a`, and `backend-b`). The stored generation runtime
remains `compose`. This is a compatibility implementation detail and should be
renamed to a backend-neutral standalone runtime in a later contract migration;
it must not be misrepresented as native dynamic Kubernetes generation support.

The chart defaults to NetworkPolicy deny-by-default plus bounded internal and
public HTTP flows. Enforcement is a CNI capability, so successful rendering is
not evidence that k3d enforces the policy. K1A reports that independently.

The Linux/AMD64 product runtime is qualified. The historical, non-reproducing
Compose migration exit remains an observability follow-up; K1A does not claim
that its root cause was discovered.

K1A qualification found and repaired four Compose-to-Kubernetes differences:
Kubernetes `command` replaces the image entrypoint (the Job Runner must use
`args`), worker probes require a non-loopback standalone bind, probe paths are
`/livez` and `/readyz`, and local-path snapshot PVCs must have a consumer before
Helm can wait for them to bind. The chart also requires `--wait-for-jobs` when
Job completion is intended to be part of the Helm operation boundary.
