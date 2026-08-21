# Custom Wikibase standalone Helm chart (K1A)

This chart maps the qualified standalone Compose product to a single Kubernetes
namespace. K1A supports only `profile=none` and `profile=virtuoso`; Fuseki,
Oxigraph, multi-instance orchestration, and Federated Platform integration are
intentionally outside this chart's current claim.

The release namespace must contain an existing Secret (default:
`custom-wikibase-secrets`) with these keys: `dbName`, `dbUser`, `dbPassword`,
`dbRootPassword`, `adminUser`, `adminPassword`, `secretKey`, `upgradeKey`,
`instanceId`, `queryDbPassword`, and `rdfAdminPassword`. The chart never embeds,
generates, or prints secret values.

Authoritative storage is MariaDB, uploads, and stable runtime state. PostgreSQL
is query-control state. Virtuoso A/B data is derived and rebuildable, not a
source-of-truth backup. Snapshot storage is bounded temporary working storage.

For the Virtuoso profile, migration and bootstrap are finite Jobs with no SQL
retry. Bootstrap waits for migrations 005–013 to be applied, and Source Reader,
workers, and Query Router remain behind a bootstrap init gate. Completed Job
logs are retained for one day. Each Helm revision creates a new idempotent pair
of Jobs so upgrades do not mutate an immutable Job.

The shared uploads/runtime PVCs use `ReadWriteOnce`; `Recreate` strategy makes
this safe for the initial single-node/single-replica target. A multi-node design
must select an appropriate RWX provisioner or revise storage ownership.

NetworkPolicy is enabled by default. Whether it is enforced depends on the CNI;
k3d/k3s qualification must report unsupported enforcement as
`NETWORK_POLICY_NOT_QUALIFIED_IN_K3D`, never as a production guarantee.

Use both `--wait` and `--wait-for-jobs` for Virtuoso install/upgrade workflows.
Plain `--wait` does not make completion of the finite migration, bootstrap, or
qualification Jobs part of Helm's success boundary.
