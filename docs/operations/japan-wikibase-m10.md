# Japan Wikibase M10 Kubernetes runtime qualification report

## Result

M10 produced a working structured Kubernetes Generation Driver and packaged
PostgreSQL, two Query Routers, and two Generation Coordinators in a fixed local
k3d cluster. The result is intentionally split:

- all three physical backend runtimes: `KUBERNETES_PHYSICAL_GENERATION_QUALIFIED`;
- Virtuoso Coordinator E–M2 lifecycle: `KUBERNETES_LIFECYCLE_QUALIFIED`;
- complete M10 real-Wikibase pipeline: `INSUFFICIENT_EVIDENCE`.

The overall M10 classification therefore remains **INSUFFICIENT_EVIDENCE**.
M9D's `LOCAL_DURABLE_RDF_SYNC_QUALIFIED` classification and backend role choices
are unchanged. No production, utirik, Controller, GitHub Actions, DNS, or
Wikidata system was accessed.

## Runtime and safety boundary

The fixed cluster is `wfp-jwb-m10`, context `k3d-wfp-jwb-m10`, using only
`/tmp/wfp-jwb-m10-kubeconfig.yaml` and a loopback API. The driver uses
`@kubernetes/client-node`; no lifecycle method invokes kubectl or accepts
manifests, namespaces, image names, URLs, or shell fragments from callers.

`jwb-query-local` contains one independent StatefulSet, Service, and PVC per
generation. Descriptors expose structured Kubernetes identity and the accepted
normalization/partition models. Full ownership labels are checked before every
mutation. Wrong ownership and unknown identifiers fail closed.

RBAC is namespace-scoped. Only the Coordinator can create/patch/delete the
fixed generation resource kinds. Router and Worker have no Kubernetes token.
Secrets hold PostgreSQL and Virtuoso credentials. NetworkPolicy uses named
namespaces, backend ports, DNS, Service/Pod CIDRs, and the observed local k3d
bridge API port; it never permits `0.0.0.0/0`.

## Physical backend evidence

Each backend ran as real ARM64 Kubernetes Pods with A/B physical isolation.

| Backend | separate A/B Service+PVC | RDF write/query | Pod restart | same PVC UID | data survived | stop/retire/delete replay | final resources |
|---|---:|---:|---:|---:|---:|---:|---:|
| Virtuoso | pass | pass | pass | pass | pass | pass | 0 |
| Oxigraph | pass | pass | pass | pass | pass | pass | 0 |
| Fuseki/TDB2 | pass | pass | pass | pass | pass | pass | 0 |

Stopping candidate B produced explicit `unavailable`, retained the Bound PVC,
and starting it recovered the same generation. StatefulSet restart did not
change generation or PVC identity. Deletion removed workload, Service, and PVC
only after ownership verification.

## Virtuoso Kubernetes Coordinator evidence

PostgreSQL, Router, and Coordinator used the real packaged M9D processes. E–M2
used actual Pod container exits with code 86 and Deployment recreation.

| Point | operation state | pointer |
|---|---|---|
| E | CREATING_GENERATION | A/v1 |
| F | LOADING_SNAPSHOT | A/v1 |
| G | WAITING_FOR_CATCHUP | A/v1 |
| H | VALIDATING | A/v1 |
| I | READY_TO_PROMOTE | A/v1 |
| J | PROMOTING | B/v2 |
| K | PROMOTING | B/v2 |
| L | CLEANING_UP | B/v2 |
| M1 | CLEANING_UP | B/v2 |
| M2 | CLEANING_UP | B/v2 |

After recovery, promotion was `COMMITTED/GENERATION_FINALIZED`. Both Router
replicas converged to pointer version 2; one Router Pod was deleted and replaced
without changing the pointer. Two Coordinator replicas left one B registry row.
PostgreSQL Pod replacement retained the same PVC UID and B pointer. Retirement
recorded attempt, physical deletion, and finalization timestamps and ended in
`METADATA_FINALIZED`. The final serving graph ASK after a post-promotion update
was true.

## Defects found and repaired

- Kubernetes client patch calls now send JSON Patch arrays explicitly.
- stopped StatefulSets cannot report healthy from stale ready replica status.
- Pod recreation selects the new non-terminating Ready Pod.
- Router/Coordinator bind to `0.0.0.0` only in explicit Kubernetes mode.
- Router accepts only fixed Kubernetes generation FQDNs.
- k3d API egress includes the observed bridge CIDR/6443 rather than unrestricted
  internet access.
- PostgreSQL Pod recreation rebuilds the qualification port-forward and pool.

## Missing evidence and skips

The following mandatory M10 evidence was not completed and is not inferred from
M9B:

- real Japan Wikibase, MariaDB, Job Runner, real entity, and RDF dump inside the
  M10 k3d cluster;
- real RecentChanges -> Source Reader -> generation-bound Worker -> backend
  pipeline in Kubernetes;
- Worker/Wikibase rolling updates and Worker cursor recovery in Kubernetes;
- full canonical Dataset equality against a fresh real Wikibase dump (the M10
  lifecycle fixture verified graph presence, not full Dataset diff);
- candidate PVC Bound while its Pod fails scheduling, and missing/wrong-label
  discovery scenarios as live-cluster tests;
- E–M2 Coordinator Pod matrix for Oxigraph and Fuseki (their physical lifecycle
  was qualified, but only Virtuoso ran Coordinator E–M2).

These omissions prevent `KUBERNETES_DURABLE_RDF_SYNC_QUALIFIED`.

## Commands and cleanup

- `npm run jwb:k8s:create`
- `npm run jwb:k8s:runtime`
- `npm run jwb:k8s:qualify -- --backend=<backend>`
- `npm run jwb:k8s:integrated`
- `npm run jwb:k8s:retirement`
- `npm run jwb:k8s:destroy`

Generation qualification cleaned all A/B/C workload, Service, and PVC resources.
The entire fixed cluster is removed at handoff.

## Exact next milestone

Continue M10—not Controller integration—as **M10B Real Kubernetes Source and
Worker Qualification**. Package the real M1 Wikibase/MariaDB/Job Runner, Source
Reader, and Worker in this fixed cluster; execute real edits, rebuild/catch-up,
promotion, post-promotion sync, retirement, full canonical equality, and the
remaining rolling/storage/discovery tests. Only then reconsider the overall
Kubernetes qualification.
