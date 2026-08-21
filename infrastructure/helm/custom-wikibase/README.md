# Custom Wikibase standalone Helm chart (K1B)

This chart maps the qualified standalone Compose product to a single Kubernetes
namespace. K1B supports the explicit profiles `none`, `virtuoso`,
`fuseki-tdb2`, and `oxigraph`. A query-enabled release selects exactly one RDF
backend family and always deploys fixed, independently persisted A/B slots.
Multi-instance orchestration and Federated Platform integration remain outside
this chart's current claim.

The release namespace must contain an existing Secret (default:
`custom-wikibase-secrets`) with these keys: `dbName`, `dbUser`, `dbPassword`,
`dbRootPassword`, `adminUser`, `adminPassword`, `secretKey`, `upgradeKey`,
`instanceId`, `queryDbPassword`, and `rdfAdminPassword`. The chart never embeds,
generates, or prints secret values.

Authoritative storage is MariaDB, uploads, and stable runtime state. PostgreSQL
is query-control state. RDF backend A/B data is derived and rebuildable, not a
source-of-truth backup. Snapshot storage is bounded temporary working storage.

For every query-enabled profile, migration and bootstrap are finite Jobs with no SQL
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

Use both `--wait` and `--wait-for-jobs` for query-enabled install/upgrade workflows.
Plain `--wait` does not make completion of the finite migration, bootstrap, or
qualification Jobs part of Helm's success boundary.

Backend services are headless/internal only. Query Router is the sole logical
SPARQL service intended for exposure; backend query, update, graph-store, and
administration endpoints are not public product boundaries.
