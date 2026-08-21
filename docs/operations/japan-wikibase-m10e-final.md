# Japan Wikibase M10E-Final Kubernetes qualification

Date: 2026-08-20

The fixed disposable cluster `wfp-jwb-m10e-final`, context
`k3d-wfp-jwb-m10e-final`, and dedicated kubeconfig
`/tmp/wfp-jwb-m10e-final-kubeconfig.yaml` were used. Its API endpoint was
loopback-only. The harness rejected other contexts and production-like server
names. The cluster was destroyed after every run, including failed runs.

## Qualified destructive-plane evidence

- Real StatefulSet, Service and PVC deletion succeeded with UID and
  resourceVersion preconditions.
- A deliberately wrong UID was rejected by Kubernetes with HTTP 409 and the
  resource survived.
- A Service update after preflight produced `RESOURCE_VERSION_MISMATCH` and
  zero deletion.
- A deleted/recreated StatefulSet with the same name received a different UID;
  the old plan was rejected and the replacement survived.
- Missing Service before cleanup produced `RESOURCE_MISSING_UNEXPECTED`; the
  remaining StatefulSet and PVC UIDs were unchanged.
- Crash after workload delete API success but before progress persistence was
  recovered from the exact durable `DELETE_INTENT` UID as
  `RESOURCE_ALREADY_DELETED_BY_OPERATION`.
- Real partial deletion resumed without workload recreation.
- Ownership change after partial deletion stopped retry and preserved the
  remaining Service and PVC.
- Wrong-label permutations for StatefulSet, Service and PVC each preserved all
  three before-state UIDs (zero mutation).

Command: `npm run jwb:k8s:m10e-final`.

## Remaining qualification gates

The run intentionally did not claim the final gate. It did not package the
Controller PostgreSQL and two Coordinator Pods into this dedicated cluster, so
the B-to-C/A-retirement race, reverse serving race, incomplete-promotion
runtime state, two-Pod lease takeover, stale Pod after fence loss, crash before
first delete, terminal PostgreSQL journal, and repeated terminal reconciliation
were not all exercised together in this environment.

Classification remains `RETIREMENT_SAFETY_CONTRACT_INCOMPLETE`. M10D was not
started.
