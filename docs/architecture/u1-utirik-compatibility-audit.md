# U1 utirik read-only compatibility audit and deployment plan

Audit date: 2026-08-21. This audit used read-only Kubernetes and host commands.
No resource, DNS record, database, certificate, workload, or configuration was
created or changed.

## Environment boundary

`abaiang` remains the disposable Linux/AMD64 development and qualification
host. `utirik` is the actual k3s orchestration and Federated Platform
integration environment. Passing K1/K2 on `abaiang` qualifies an artifact; it
does not make that host an orchestration platform.

## Observed utirik environment

- single AMD64 Ubuntu 22.04 node, k3s/Kubernetes `v1.36.2+k3s1` and
  containerd `2.3.2-k3s2`;
- 96 allocatable CPUs, about 755 GiB memory, and 855 GiB free local disk;
- 71 running Pods out of the node limit of 110 at audit time;
- default `local-path` StorageClass, `WaitForFirstConsumer`, reclaim policy
  `Delete`;
- Traefik `40.1.3 / 40.1.0`, default `IngressClass=traefik`, with namespaced
  Middleware CRDs;
- cert-manager with ready Let's Encrypt staging and production ClusterIssuers;
- namespace Pod Security policy is normally `enforce=baseline`,
  `warn/audit=restricted`;
- k3s `disable-network-policy: false`; existing instance namespaces use
  default-deny plus explicit internal, Traefik, and ACME policies;
- existing instances use one namespace and one Helm release per Wikibase with
  `wb-<instance>` names and stable instance UUID labels;
- existing Wikibase Suite instances share
  `mariadb.data-mariadb-smoke.svc.cluster.local:3306`, with a distinct logical
  database and Secret reference per instance;
- existing public routes use
  `<instance>.wb.utirik.lodac.nii.ac.jp` and
  `query-<instance>.wb.utirik.lodac.nii.ac.jp`, Traefik, cert-manager TLS, and
  read-only/body-size/rate-limit middleware on SPARQL;
- existing Wikibase workloads have explicit requests/limits and baseline-safe
  controls such as `allowPrivilegeEscalation: false` and RuntimeDefault
  seccomp;
- host Helm CLI was not available to the audit user. k3s-managed Traefik uses
  HelmChart resources. A pinned external Helm client or an approved deployment
  mechanism is therefore required.

## Compatibility matrix

| Area | Result | U1 consequence |
| --- | --- | --- |
| Kubernetes APIs | Compatible | Current chart uses stable core/apps/networking APIs. Render and server-side dry-run must still gate deployment. |
| AMD64 images | Qualified on abaiang | U1 needs immutable, pullable OCI references. Local `japan-wikibase/*` tags are not a delivery mechanism. |
| Namespace/release | Compatible with changes | Use a reserved `wb-<instance>` qualification name and add existing platform labels/Pod Security labels. |
| StorageClass | Technically compatible, high deletion risk | `local-path` supports current RWO PVCs, but `Delete` means namespace/PVC removal can delete data. Record PV/PVC UID and require explicit retention policy. |
| Pod capacity | Core-only fits; query profile needs reservation | Core needs roughly three active Pods. Virtuoso profile adds PostgreSQL, two backends, router, reader, and workers; the node's 110-Pod ceiling matters before multi-instance growth. |
| Traefik | Compatible but absent from chart | Add bounded optional Ingress resources or a separate U1 integration layer. Expose only Wikibase and logical Query Router. |
| TLS | Compatible but absent from chart | Use cert-manager `letsencrypt-staging` first; production issuer only after DNS and staging qualification. |
| NetworkPolicy | Expected compatible, not yet qualified for this chart | Align policy selectors with Traefik and ACME solver patterns and prove enforcement in the qualification namespace. |
| Pod Security | Baseline likely admits; restricted does not yet pass | The Core image performs root-owned initialization and the chart lacks explicit security contexts. Add baseline controls before U1 and treat restricted warnings as hardening work. |
| Resources | Incomplete | Current chart defaults to empty requests/limits. U1 values must set every container, including init Jobs. |
| MariaDB | Both models feasible | Use instance-local MariaDB for the first U1 deployment to isolate product integration. External shared MariaDB becomes a later Platform-injected option. |
| JWB PostgreSQL | Instance-local proven | Keep instance-local for U1 Virtuoso. Do not reuse Knotbase PostgreSQL. Shared infrastructure requires UUID-scoped source/query identities first. |
| Runtime discovery | Boundary repaired locally | It must publish HTTPS MediaWiki and logical query URLs and never publish cluster-local source URLs. |
| Backup | Not implemented | U1 data is disposable qualification data. No production-shaped claim until MariaDB/uploads/PostgreSQL backup and restore are qualified. |
| Existing Suite coexistence | Compatible by namespace in principle | Use unique names, labels, hostnames, Secrets, databases, PVCs, and Ingress. Do not modify existing Suite/test/restore resources. |

## U1 blockers before any deployment

1. Complete and checkpoint ADR-0038 and the public/internal URL implementation.
2. Publish or transfer immutable AMD64 OCI images through an approved artifact
   path and verify their digests on utirik without building there.
3. Add explicit resource requests/limits and baseline security contexts. The
   Core initialization/root requirement must be documented and minimized.
4. Add bounded Traefik/cert-manager integration with staging TLS and existing
   middleware conventions. Do not create DNS until separately approved.
5. Add platform-compatible namespace/resource labels and a unique,
   UUID-derived source/query identity. Fixed `jwb-standalone` identities must
   not enter a future shared PostgreSQL control plane.
6. Decide the qualification PVC retention contract. Helm uninstall and
   namespace deletion must remain distinct from an explicit purge.
7. Run pinned Helm 4.2.2 lint/template and Kubernetes server-side dry-run
   against the exact reviewed U1 values before requesting deployment approval.

## Proposed U1 sequence

### U1-A: Core-only

- reserve one new qualification instance name, namespace, UUID, MediaWiki
  hostname, and Secret references;
- use `profile=none`, instance-local MariaDB, small `local-path` PVCs, explicit
  resources, and no Controller involvement;
- initially validate through a bounded port-forward;
- after DNS approval, add Traefik Ingress and Let's Encrypt staging TLS;
- verify runtime discovery, canonical RDF/MediaWiki identity, entity and upload
  persistence, stop/start/restart, NetworkPolicy behavior, and uninstall
  retention semantics;
- remove only the qualification namespace after its retention decision is
  explicitly confirmed.

### U1-B: Virtuoso query subsystem

- use a separate reviewed qualification namespace unless U1-A is intentionally
  destroyed first;
- retain instance-local PostgreSQL and A/B Virtuoso PVCs;
- expose only the logical Query Router `/sparql` endpoint;
- validate snapshot, catch-up, equality, promotion, rollback, public read-only
  enforcement, TLS identity, restart, and cleanup;
- keep internal backend, update, database, and source URLs private.

### U1-C: Platform observation

Only after U1-A/B pass, register the instance as
`runtimeType=custom-wikibase` and prove read-only observation. The Platform
should see instance lifecycle, public endpoints, health, and query capability;
it should not see backend A/B slots, serving-pointer implementation, snapshots,
or backend administration endpoints. Create/start/stop/restart through the
Controller remains a later, separately approved step.

## Database direction

Standalone Custom Wikibase must continue to support its own MariaDB and
PostgreSQL. The hosting Platform may later inject shared database services with
one logical database/role per stable instance UUID. Shared MariaDB matches the
existing utirik pattern, but shared JWB PostgreSQL must be a new independent
service and must not reuse Knotbase PostgreSQL. Neither shared option belongs in
the first U1 deployment.
