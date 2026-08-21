# U1-A utirik Core-only qualification

Date: 2026-08-22 (JST)

## Scope and classification

`custom-qualification-01` is retained in namespace and Helm release
`wb-custom-qualification-01`. The installed profile is `none`: Wikibase,
Job Runner, and instance-local MariaDB only. No Query Control PostgreSQL,
Source Reader, RDF worker, Query Router, or RDF backend is installed.

The port-forward phase is classified
`CUSTOM_WIKIBASE_U1A_CORE_PORT_FORWARD_QUALIFIED`. The completed public phase
is classified `CUSTOM_WIKIBASE_U1A_CORE_UTIRIK_QUALIFIED`. This is an
integration qualification, not a production-readiness claim.

## Immutable images and source

- Product source: `dbd16ac89cbe4b24d011866b2bf8e004d30cd419`
- U1 values and public packaging source: through `ba363f5`
- Core: `japan-wikibase/core@sha256:fcdf50b720fb42984103fac094ae575db8f8947989ea1633f0ddeb435f168524`
- Core platform: `linux/amd64`
- Core OCI archive SHA-256: `71026996a62cbc6a5664a9ac12142d97c27aec247c0477432ae31fe5b2f1a9ab`
- MariaDB: `mariadb:10.11.14@sha256:dbe56e20372fc6d6b8e0e396866ba89c4c7f128c38c4f59aaa54d957db95790c`
- Distribution: bounded archive import into the k3s `k8s.io` containerd
  namespace. No registry or production credential was added.

The initially imported RC image predated the public/internal URL boundary.
It was rejected by the runtime-contract gate and replaced by the exact-source
U1 image above. Kubernetes/containerd also required the standard
`repository@digest` reference; `repository:tag@digest` did not resolve with
`imagePullPolicy: Never`.

## Resources and Pod Security

| Workload | Requests | Limits |
| --- | --- | --- |
| Wikibase | 250m CPU / 512Mi | 2 CPU / 2Gi |
| Job Runner | 50m CPU / 128Mi | 500m CPU / 512Mi |
| MariaDB | 250m CPU / 512Mi | 2 CPU / 2Gi |

All U1 containers use `allowPrivilegeEscalation: false` and pod-level
`seccompProfile: RuntimeDefault`; service-account token automount is disabled.
The namespace enforces `baseline` and warns/audits `restricted`. Restricted
warnings remain for `runAsNonRoot` and `capabilities.drop: [ALL]`: the current
Core bootstrap changes PVC ownership and Apache binds port 80 as root. No
privileged container, hostPath, hostPID, hostNetwork, or added capability is
used. A non-root init/steady-state image split remains a product hardening
item.

## Persistent state contract

PVC identities retained through Pod recreation and stop/start:

- MariaDB `data-mariadb-0`: `468f010c-167b-4479-a19a-aab6e88e5a4c`
- runtime identity `runtime-state`: `8413aaf8-d3b6-42f0-9319-2d320a6ad427`
- uploads `uploads`: `fbd766a5-cb73-4411-8155-51e67c33f576`

All use `local-path`, whose PV reclaim policy is `Delete`. The standalone PVCs
have Helm `keep`; StatefulSet claim retention was observed across release
uninstall/reinstall. `uninstall` is not `purge`. Namespace deletion or explicit
PVC deletion can delete authoritative data and is outside normal lifecycle
operations. No automatic purge exists or was tested.

## Qualification evidence

- MediaWiki 1.43.9, language `ja`, timezone `Asia/Tokyo`
- WikibaseRepository loaded
- instance UUID `a622a3e7-ff84-46bf-bf41-88410024e183`
- runtime contract `jwb-runtime-v1`, final HTTPS endpoints,
  `queryService.enabled=false`
- harmless Item `Q1`, revision 2
- upload `U1AQualificationPixel.png`, SHA-1
  `2115a1d881432165b3be8d5059cd4a2ba1c0f58e`
- individual Wikibase, Job Runner, and MariaDB Pod recreation preserved UUID,
  entity, upload, and PVC UIDs
- stop scaled both Deployments and the StatefulSet to zero; start restored all
  three to one without uninstall or data loss
- no-op Helm upgrade completed and preserved data
- staging and production cert-manager issuance completed
- production Certificate uses `letsencrypt-production`, secret
  `custom-qualification-01-tls`, SAN
  `custom-qualification-01.wb.utirik.lodac.nii.ac.jp`
- HTTP redirects to HTTPS; security headers, 10 MiB body limit, and bounded
  rate limit are namespace-scoped Traefik Middleware resources
- unrelated Pod access to MariaDB was rejected; MariaDB has no NodePort;
  Traefik, ACME HTTP-01, DNS, and Core flows succeeded

Network policy is classified `NETWORK_POLICY_CORE_ENFORCEMENT_QUALIFIED`.
The default deny initially blocked the cert-manager solver, which was repaired
with a selector-bound TCP/8089 ingress policy for HTTP-01 solver Pods only.

## Known differences and follow-up

- The retained Helm release uses a production issuer override; the committed
  qualification values intentionally remain staging-first. A future deployment
  layer should render environment-specific final values explicitly.
- Imported image archives are acceptable for qualification but not an
  operational distribution strategy. Use an authenticated OCI registry with
  immutable multi-architecture manifests and provenance for releases.
- Stop/start currently means structured scaling of every release workload.
  The future adapter must persist desired replicas and reconcile the full
  workload set; it must not uninstall or issue arbitrary shell commands.
- Add explicit StatefulSet PVC retention policy where supported, plus backup
  and restore qualification, before production use.
- Separate root-only initialization from a non-root steady-state Core image to
  close restricted Pod Security warnings.

## U1-B plan

U1-B is not executed. It should add instance-local **Query Control
PostgreSQL**, Source Reader, Worker A/B, Snapshot Producer, Query Router, and
Virtuoso A/B; expose one query hostname with TLS; then qualify snapshot,
catch-up, equality 0/0, promotion, rollback, restart, and query-path Network
Policy. Query Control PostgreSQL is distinct from any Federated Platform
Controller database.

## Future database placement

Model A keeps MariaDB and Query Control PostgreSQL instance-local. Model B
allows a Federated Platform deployment to inject shared managed database
infrastructure with one logical database and role per instance. Custom
Wikibase must keep Model A independently operable. Model A remains the product
default; Model B should be an explicit platform integration capability with
separate credentials, backup ownership, quotas, and failure-domain policy.
