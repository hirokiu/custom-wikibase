# M10 disposable Kubernetes runtime

The fixed cluster is `wfp-jwb-m10`, its context is `k3d-wfp-jwb-m10`, and its
only accepted kubeconfig is `/tmp/wfp-jwb-m10-kubeconfig.yaml`. Generation
resources live in `jwb-query-local`; the Coordinator service account is bound
to a namespace Role and cannot create namespaces, read Secrets, exec into Pods,
or mutate unrelated resource kinds.

Each physical generation is one StatefulSet, one ClusterIP Service, and one
PVC. Pod replacement retains generation identity and storage. Stop/retire scale
the StatefulSet to zero. Only final `deleteGeneration` removes the owned
StatefulSet, Service, and PVC after checking every ownership label.

The NetworkPolicies intentionally use namespace selectors and fixed ports. They
are a local executable policy, not a production-ready cross-cluster policy.
Kubernetes API access uses the mounted service-account channel. k3d currently
DNATs `kubernetes.default` to the dedicated Docker network (`172.26.0.0/16` in
the fixed local cluster), so only TCP 6443 on that local bridge is allowed in
addition to the Service/Pod CIDRs. No unrestricted internet CIDR is allowed;
production must derive an exact control-plane CIDR instead of copying this rule.
