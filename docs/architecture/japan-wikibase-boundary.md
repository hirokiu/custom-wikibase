# Japan Wikibase J1 repository boundary

## Contract and lifecycle boundary

Japan Wikibase is a standalone distribution. Its read-only discovery document
is defined by `packages/runtime-contract/jwb-runtime-v1.schema.json` and is
intended for `GET /.well-known/japan-wikibase-runtime`. J1 specifies the
document but does not implement that HTTP endpoint.

`contractVersion` versions the integration shape and semantics. Distribution
`version` versions the product release independently. `instance.id` is a stable
UUID which survives restart and release upgrade. Logical HTTP endpoints remain
stable across internal Pod and generation replacement.

Health is the distribution's aggregate assessment: `healthy`, `degraded`,
`unhealthy` or `unknown`. When query is enabled, `backendType` is the selected
allowlisted implementation, `syncState` is synchronization progress,
`freshness.cursorTimestamp` is the latest durably applied source cursor time,
and `lagSeconds` is a non-negative observation at document generation time.
`servingGeneration` identifies the internal logical generation selected by the
Query Router; it is observable metadata, not permission to operate it.

Query-disabled form is exactly:

```json
{"enabled": false}
```

No internal endpoint, Kubernetes identity, credential, database information,
deletion authority or journal is permitted. RDF semantics are independently
versioned as `jwb-rdf-normalization-v1` and `jwb-partition-v1`.

## Dependency rule

Japan Wikibase runtime code must not import Controller Registry, users/owners,
host placement or Platform lifecycle services. Platform runtime code must not
import generation repositories, serving pointers, backend update adapters or
Japan Wikibase PostgreSQL repositories. The current violations are structural:
RDF migrations 005--013 share `packages/database`, RDF backend types share
`packages/domain`, and JWB commands share the root package. They are recorded
for relocation; no new cross-boundary dependency is approved.

Future enforcement should read `repository-ownership.json`, resolve relative
and workspace imports, and fail when a runtime source crosses between
`JAPAN_WIKIBASE` and `FEDERATED_PLATFORM`. `SHARED_CONTRACT` may be consumed as
a versioned schema artifact. J1 does not introduce a shared npm source package.

## Kubernetes influence assessment

| Concern | Classification | External requirement |
|---|---|---|
| MediaWiki/Job Runner grouping | internal JWB detail | jobs drain before an instance is reported stopped |
| MariaDB ownership and PVC | internal JWB detail | instance stop preserves persistent data |
| uploads/runtime volumes | internal JWB detail | stable instance data survives restart/upgrade |
| optional query subsystem | externally visible runtime requirement | contract reports enabled state and logical endpoint |
| query PostgreSQL | internal JWB detail | never exposed to Platform |
| backend/generation PVCs | internal JWB detail | no Platform generation/PVC operation |
| readiness/liveness | Platform integration concern | pinned release supplies aggregate readiness |
| graceful shutdown | Platform integration concern | chart defines bounded safe instance stop behavior |
| internal generations | internal JWB detail | only serving generation/freshness are observed |
| instance Start/Stop/Restart | Platform concern | applied to the release as a whole, not selected Pods |

The Platform needs a chart-level lifecycle contract: which release workloads
scale to zero, which maintenance components must stop first, and confirmation
that PVCs remain. It does not need the internal workload names in the public
runtime document. These operational selectors belong to the pinned chart's
machine-readable release metadata, not user input.

## Future staging and repository layout

No J1 file is moved. The approved staging prefix for a later boundary commit is
`components/japan-wikibase/`, containing `apps`, `packages`, `services`,
`docker`, `infrastructure/compose`, `infrastructure/helm`, `tests`, `scripts`,
`docs` and `migrations`.

The extracted repository will use:

```text
japan-wikibase/
├── apps/
├── packages/
├── services/
├── docker/
├── infrastructure/
│   ├── compose/
│   └── helm/
├── tests/
├── scripts/
├── docs/
├── LICENSE
├── NOTICE
├── package.json
└── README.md
```

Current mappings are machine-readable in `repository-ownership.json`. M1--M10
reports move to `docs/history/`; current overview, runtime contract, RDF sync,
backend selection, security, Docker/Kubernetes quickstarts and development
guides become maintained product documentation. M10E remains later safety
qualification history. Historical reports are not deleted.

## Release boundary

Japan Wikibase v0.1 does not require the Controller, utirik, the existing WBS
instances or automatic physical generation deletion. It requires standalone
Compose and Kubernetes, core-only and three backend profiles, persistence,
backend conformance, canonical RDF equality and ARM64/AMD64 qualification.

## Dirty-worktree checkpoint

1. Capture `git status --short` without resetting or stashing.
2. Scan intended files for `.env`, kubeconfig, credentials, keys, rendered
   Secrets and runtime state; confirm ignore rules before staging.
3. Classify every path using the ownership manifest and review `NEEDS_REVIEW`.
4. Commit existing Platform work separately from Japan Wikibase work.
5. Commit contract/ADR changes independently from mechanical relocation.
6. Run `npm run check`, pinned Helm 4.2.2 `npm run helm:check`, contract tests
   and `git diff --check`; record the clean checkpoint SHA.
7. Relocate only from that reviewed checkpoint into the single prefix.
8. Repeat secret and regression checks after relocation.
9. Run subtree split only from a clean committed state and verify locally before
   any remote repository is created.

At J1 inspection time the primary JWB directories and scripts are untracked;
`git ls-files` returned zero tracked JWB implementation files. Shared tracked
files modified by the accumulated work include the root package manifests and
ADR index. Nothing is automatically added or committed by J1.
