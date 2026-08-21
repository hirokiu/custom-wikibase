# ADR-0033: Kubernetes RDF generations use owned StatefulSet/Service/PVC triples

Status: accepted for disposable local qualification

## Decision

Kubernetes physical RDF generations share one fixed query namespace while each
generation owns an independent StatefulSet, ClusterIP Service, and PVC. This
avoids granting namespace-creation permission and still provides physical
workload, endpoint, and storage isolation.

Identity is derived only from the fixed local instance, validated generation
ID, and allowlisted backend profile. Every mutation first verifies the complete
ownership label set. Query endpoints are internal fixed service FQDNs; Query
Router's SSRF allowlist contains only the six A/B backend FQDNs.

The Coordinator service account receives a Role in the query namespace for
StatefulSets, Services, PVCs, and read-only Pods. Router and Worker service
accounts do not mount Kubernetes credentials. None receives cluster-admin,
Secret read, pod exec, or namespace mutation rights.

Stop and retire scale the StatefulSet to zero and preserve its PVC. Restart
changes only the Pod template. Final deletion follows the fenced, two-phase
all-resource preflight and progress-journal contract in ADR-0034.

## Consequences

- Pod UID is not generation identity; PVC UID and durable registry identity
  survive Pod recreation.
- A candidate is not visible through the logical Router before pointer CAS.
- Local k3d NetworkPolicy requires its Docker bridge control-plane CIDR on TCP
  6443 in addition to Service and Pod CIDRs. This rule is not portable to
  production and must be derived there.
- The Compose driver remains available for M1–M9D regression only.
