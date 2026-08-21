# K2 multi-instance Kubernetes qualification

K2 was executed on the disposable Linux/AMD64 k3d cluster
`custom-wikibase-k2-amd64` on `abaiang`. It did not use production DNS,
credentials, kubeconfig, or services. The result is
`CUSTOM_WIKIBASE_K2_MULTI_INSTANCE_QUALIFIED` for the tested three-instance
topology; it is not a production sizing or NetworkPolicy-enforcement claim.

| Release / namespace | Profile | Instance UUID |
| --- | --- | --- |
| `cw-a` | `virtuoso` | `11111111-1111-4111-8111-111111111111` |
| `cw-b` | `oxigraph` | `22222222-2222-4222-8222-222222222222` |
| `cw-c` | `none` | `33333333-3333-4333-8333-333333333333` |

All three releases ran simultaneously. Each had its own namespace, Secret,
MariaDB, uploads/runtime PVCs, and Helm release. Query-enabled releases also
had independent PostgreSQL, A/B backend PVCs, source reader, workers, and query
router. Runtime discovery returned the expected UUID and profile for every
instance. Bounded entities and PNG uploads were unique to each instance.

Action API enumeration showed only the owning instance's fixture label. After
independent snapshot/load/validation/promotion, each logical SPARQL dataset
contained its own label and not the other query-enabled instance's label.
Cross-namespace reuse of the MariaDB credentials in both directions and of the
PostgreSQL credentials from `cw-a` to `cw-b` was rejected. The rendered chart
contained no cluster-scoped kind and no chart-managed cluster-scoped resource
was observed.

Rebuilding and promoting `cw-a` did not change the `cw-b` Helm revision.
Rebuilding and promoting `cw-b` did not change the `cw-a` or `cw-c` revision;
the latter two Action APIs returned HTTP 200 during all 120 one-second samples.
The candidate worker was deliberately stopped before each snapshot load, then
started for catch-up and canonical validation before promotion.

Stopping every `cw-a` Deployment and StatefulSet reached zero running Pods
while retaining all PVC identities. `cw-b` and `cw-c` remained healthy. Starting
the same bounded workload set restored the entity, upload, UUID, serving state,
and PVC identities. Restarting every `cw-b` workload preserved the same data,
UUID, serving state, and PVC identities while `cw-a` and `cw-c` returned HTTP
200 during all 90 one-second samples.

## Findings and limitations

- External `publicUrl` and the URL used by the RDF worker to retrieve
  `Special:EntityData` are currently the same setting. Per-host loopback URLs
  correctly failed closed as `ENTITY_RDF_REDIRECT_UNTRUSTED`. K2 used the
  namespace-qualified service names
  `http://wikibase.<namespace>.svc.cluster.local`. Product packaging should
  split canonical public identity from the trusted internal source endpoint.
- Runtime discovery still advertises the Compose-era fixed ports (`8280` and
  `8290`) and persisted runtime/source identifiers remain
  `standalone-compose`, `compose`, and `jwb-standalone`. They are safe only
  because each release currently has an independent PostgreSQL database. These
  identifiers must become instance-scoped before a shared control plane.
- A plain Helm uninstall retained the StatefulSet-generated MariaDB PVC. K2
  recorded that residue, then removed the disposable namespace. The product
  needs an explicit retention/deletion policy and an intentional purge command;
  uninstall must never silently imply data deletion.
- The opt-in snapshot/coordinator Jobs increment the product Helm release
  revision. They should move to a separate qualification/operations harness.
- Virtuoso returned an upstream failure for one constant-false ASK form, while
  enumeration with SELECT was correct. Backend conformance should retain a
  regression test for false-result query forms.
- Standard k3d does not provide NetworkPolicy-enforcement evidence. K2 verifies
  namespace, credential, service, storage, Helm, and logical data isolation,
  not CNI enforcement.
- Backend image import by digest emitted containerd missing-content warnings and
  k3s subsequently used the pinned registry references. Offline installation
  needs a verified OCI archive/import path.
- K2 used sequential Helm installs and conservative test storage. It is not a
  concurrency, capacity, noisy-neighbor, quota, backup, or disaster-recovery
  qualification.

Evidence is kept outside Git under
`/home/hiroki_u/custom-wikibase-qualification/artifacts/kubernetes-k2` on the
qualification host. It contains no credential values.
