# Japan Wikibase M10B — real Kubernetes source qualification

Date: 2026-08-20. Scope: disposable local `wfp-jwb-m10` k3d cluster only.

## Result

Overall classification: **INSUFFICIENT_EVIDENCE**.

The real source-side gate and the Virtuoso A/B data path are qualified, but the
complete M10B gate is not. The cutover evidence below used the structured
PostgreSQL serving-pointer repository directly, not a packaged Coordinator
operation; Oxigraph, Fuseki/TDB2, and cross-backend migration were not run.

## Topology exercised

```text
jwb-system                       jwb-instance-local-01
  PostgreSQL (PVC)                 Japan Wikibase web (uploads/runtime PVC)
  Router x2                        Job Runner
  Coordinator x2                  MariaDB StatefulSet (PVC)

jwb-query-local
  generation workloads (M10 driver; not populated during source-only gate)
```

The retained sync packaging places Source Reader in `jwb-system` and Worker in
`jwb-instance-local-01`. The Worker service account has no Kubernetes API token
or generation mutation RBAC. Its backend descriptor is derived from the fixed
backend/generation allowlist; a caller cannot supply a namespace or endpoint.

## Verified evidence

- Docker Desktop server and the k3d node were native `arm64`; k3s used
  `containerd://2.2.3-k3s1`.
- The source image was `wfp/japan-wikibase:m10b`, image ID
  `sha256:f048f3d4197bd2d932f6a3f895821dc09cfb3607eae3348e6dd077332de82d1c`.
  It is the already-built M1 image: MediaWiki 1.43.9 and Wikibase commit
  `c79eb4efab9ad27267a6df9034e1b99ad695d1c7`.
- MariaDB used the pinned 10.11.14 digest. Japan Wikibase and Job Runner reached
  Ready with Japanese defaults and `Asia/Tokyo` configuration.
- A real API fixture was created with Items, Properties, Japanese/English
  terms, aliases, string, external ID, quantity, time, Item relation, qualifier,
  and reference. The successful run used Q4–Q6 and P10–P16.
- Wikibase Web Pod recreation retained Q5.
- MariaDB Pod recreation retained Q5 and the MariaDB PVC UID.
- All three source PVC identities were unchanged: MariaDB 1 GiB, uploads 256
  MiB, runtime state 128 MiB.
- `dumpRdf.php` executed inside the Kubernetes Wikibase Pod. The 126,244-byte
  canonical source passed `jwb-rdf-normalization-v1` and
  `jwb-partition-v1`, producing 35 named graphs and no authoritative default
  graph.
- Worker Kubernetes configuration and the API-free data-plane backend factory
  are unit-tested fail closed for foreign source, PostgreSQL, update endpoint,
  namespace, backend, and generation identities.
- Virtuoso A loaded 18 partitions from the real dump. Before and after a real
  Q2 edit, canonical equality was 0/0; its fence reached revision 14/CURRENT.
- Source Reader and generation-bound Worker ran as real Pods with no service
  account token. Source ingestion and generation cursors advanced from real RC.
- Virtuoso B used a distinct StatefulSet, Service and 512 MiB PVC. It bootstrapped
  at C0 while A served, then a second Worker replayed real Item, Property, delete,
  and undelete events with an independent generation fence.
- B reached schema state CURRENT, restored the disposable Item to CURRENT, and
  passed canonical Dataset equality 0/0 before cutover.
- Serving pointer CAS changed A to B with `previous_generation_id=gen-a` and
  version 2. A post-promotion edit advanced B to rcid 19 and revision 17/CURRENT.
- Two Router Pods remained Ready. The stable Router contract exposes pointer
  version, not a physical generation-ID response header.
- Kubernetes portability defects found and repaired: fixed service FQDN
  allowlists below configuration, Pod health binding, Linux `/tmp`, and B Worker
  NetworkPolicy selection.

The machine-readable source result was written only to the disposable local
path `/tmp/wfp-jwb-m10b-source-evidence.json`; it contains no credentials.

## Resource observations

These are local requests, not production sizing:

| Component | CPU request | Memory request |
|---|---:|---:|
| Wikibase | 100m | 256 MiB |
| Job Runner | 25m | 128 MiB |
| MariaDB | 50m | 192 MiB |
| PostgreSQL | 50m | 96 MiB |
| Router (each) | 25m | 64 MiB |
| Coordinator (each) | 25m | 96 MiB |

Actual PVC consumption and runtime CPU/RSS were not measured in this run.

## NetworkPolicy finding

The policies are accepted by the Kubernetes API and the allowed Wikibase ↔
MariaDB path worked while default deny was present. DNS and system-to-instance
HTTP also worked. This is not proof of complete policy enforcement: the k3d CNI
enforcement matrix, Worker-to-generation flow, Kubernetes API egress exception,
and explicit denied-flow probes were not executed. The M10 k3d-specific API
CIDRs remain test-only and are not production-ready policy.

## Not qualified / explicit skips

- packaged Generation Coordinator operation driving the A→B promotion
- explicit observation of the intermediate `DELETED -> RESTORING -> CURRENT`
  states (the final restored CURRENT state and graph were verified)
- final canonical 0/0 equality after the post-promotion edit
- two-Router concurrent OLD_COMPLETE*/NEW_COMPLETE* sampling during the exact
  CAS boundary
- all restart and rolling-update cases beyond Wikibase and MariaDB Pod recreation
- PostgreSQL persistence in this M10B run
- full live discovery matrix, wrong-label mutation rejection, missing-PVC case
- retirement/cleanup of A/B
- Oxigraph and Fuseki durable synchronization
- Virtuoso-to-Oxigraph migration
- rebuild, catch-up, promotion, query-latency, and sync-lag timing

Virtuoso is **QUALIFIED_LOCAL_KUBERNETES_DURABLE_SYNC_WITH_LIMITATIONS** for the
source/Worker/A/B/CAS data path. Fuseki and Oxigraph remain
**INSUFFICIENT_EVIDENCE** for M10B. Earlier M10 physical-generation results and
backend roles stay unchanged.

## Controller boundary proposal (M11 only)

Expose `QueryService` as backend type, logical endpoint, backend/router health,
sync state/freshness, serving/rollback generation, and rebuild state. Do not
expose Pod/PVC names, container ports, backend admin endpoints, or Kubernetes
credentials. No Controller code was changed.

## Commands

```sh
npm run jwb:k8s:create
npm run jwb:k8s:runtime
npm run jwb:k8s:m10b:source
npm run jwb:k8s:m10b:qualify-source
npm run jwb:k8s:m10b:qualify-virtuoso
npm run jwb:k8s:m10b:qualify-virtuoso-b
npm run jwb:k8s:m10b:post-promotion
npm run jwb:k8s:m10b:destroy
```

All commands are pinned to context `k3d-wfp-jwb-m10` and kubeconfig
`/tmp/wfp-jwb-m10-kubeconfig.yaml`; target validation rejects production-like
contexts and non-loopback API servers.

## Exact next milestone

**M10B-2 — Virtuoso A/B real Worker qualification**: seed the fixed Registry,
bootstrap A from the in-cluster dump, deploy the packaged Source Reader and
Worker, prove real edits/delete/undelete, build and catch up B, require canonical
0/0 equality, promote through the packaged Coordinator/Router, run the restart
and ownership matrices, and destroy the cluster. Only after that gate passes
should the same harness be parameterized for Oxigraph, Fuseki, and migration.
