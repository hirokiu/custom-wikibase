# Japan Wikibase M2 RDF backend conformance

M2 evaluates derived RDF stores without making any store authoritative. MediaWiki/Wikibase remains the source of truth, and the M1 `core` profile still starts with no RDF service. The local profiles are disposable and accept exactly one fixed backend name.

## Profiles and support status

| Conceptual profile | Adapter | Apple Silicon status | Notes |
|---|---|---:|---|
| `core` | none | supported | M1; no SPARQL dependency |
| `query-fuseki` | Fuseki 6.1.0 / TDB2 | conformance target | Java 21 multi-architecture image and checksum-pinned Jena archive |
| `query-virtuoso` | Virtuoso Open Source 7.2.17 | conformance target | multi-architecture upstream image |
| `query-blazegraph` | Wikibase/WDQS 2.1.0 | skipped on ARM64 | `architecture_unavailable`; existing AMD64 Stage B remains the compatibility execution path |
| `query-oxigraph` | Oxigraph 0.5.7 | lightweight candidate | conformance target, not a production-readiness claim |
| `query-qlever` | contract/research only | not packaged | evaluate as both a per-instance and aggregated federation backend |

Only the Fuseki, Virtuoso, and Oxigraph Compose files are executable on this Mac profile. All images are digest-pinned. No profile refers to production DNS, credentials, volumes, or kubeconfig.

## Commands

```sh
npm run jwb:create
npm run jwb:rdf:dump
npm run jwb:rdf:test -- --backend=fuseki-tdb2
npm run jwb:rdf:test -- --backend=oxigraph
npm run jwb:rdf:test -- --backend=virtuoso
npm run jwb:rdf:test -- --backend=blazegraph-wdqs
```

`jwb:rdf:dump` creates multiple real Items and Properties through the Wikibase API. It covers strings, external IDs, quantities, times, item values, Japanese/English terms, aliases, a qualifier, and a reference. Generated Q/P identifiers are stored in `/private/tmp/wfp-jwb-m2-dataset.json`; credentials are never included. `dumpRdf.php` produces `/private/tmp/wfp-jwb-m2-snapshot.nt` and exact duration, byte, triple and SHA-256 metrics.

The backend test loads that snapshot, runs backend-neutral SPARQL assertions, restarts the service and repeats them, replaces a test-only named graph, exports, rebuilds from the canonical snapshot, and resets. Exact measurements are written to `/private/tmp/wfp-jwb-m2-<backend>-result.json`. The dedicated Compose project and its disposable volume are always removed after the test. Blazegraph records an explicit architecture skip rather than silently emulating AMD64.

## Security boundary

The adapter returns separate `public-read` query and `internal-write` endpoint descriptors. These local Compose ports bind only to `127.0.0.1`; the internal endpoint is reachable solely because the host test harness needs it. A deployment must expose only the query endpoint through its read-only proxy/Ingress and keep update and Graph Store endpoints inside the synchronization service boundary. Endpoint URLs are fixed by backend profiles, credentials are generated per run, and no user-supplied URL or SPARQL `SERVICE` target is accepted.

`replaceNamedGraph` proves only that an isolated graph can be updated. A Wikibase entity RDF fragment can share value/reference nodes with other fragments, so this experiment does not establish a safe production incremental algorithm. Snapshot rebuild remains the conservative synchronization strategy until ownership, revision ordering, blank/skolem node behavior, and deletion semantics are specified and tested.

## Backend observations and QLever direction

- Fuseki/TDB2 is the clearest portable baseline for standards-oriented Graph Store and SPARQL 1.1 tests.
- Virtuoso remains a primary compatibility target and offers operationally mature federation/full-text extensions, but those extensions are not part of the common contract.
- Blazegraph/WDQS remains required for existing Wikibase Suite compatibility; its Wikibase Label Service is optional capability metadata, never a Controller dependency.
- Oxigraph is attractive for lightweight local use, but upstream describes it as under heavy development and its query optimizer should be measured with realistic data before adoption.
- QLever supports SPARQL, named graphs and update surfaces, but should first be evaluated as an aggregated/federation query layer. Its update-delta behavior and per-instance footprint require dedicated measurements before promotion to an executable M2 profile.

Primary references: [Apache Jena downloads](https://jena.apache.org/download/index.cgi), [Fuseki Docker and command-line tools](https://jena.apache.org/documentation/fuseki2/fuseki-docker.html), [Virtuoso releases](https://github.com/openlink/virtuoso-opensource/releases), [Oxigraph](https://github.com/oxigraph/oxigraph), and [QLever](https://github.com/ad-freiburg/qlever).

## 2026-08-19 Apple Silicon measurements

The canonical snapshot contained 343 triples and 43,998 bytes; `dumpRdf.php` took 205 ms. These are one-run observations on the current MacBook Pro and are not capacity estimates.

| Backend | Result | Startup | Snapshot load | Restart recovery | Image bytes | Observed memory |
|---|---:|---:|---:|---:|---:|---:|
| Fuseki/TDB2 | passed | 1,662 ms | 119 ms | 1,705 ms | 396,884,505 | 382.1 MiB |
| Virtuoso | passed | 7,271 ms | 23 ms | 2,293 ms | 157,669,806 | 111.9 MiB |
| Oxigraph | passed | 6,370 ms | 6 ms | 4,280 ms | 53,181,062 | 10.37 MiB |
| Blazegraph/WDQS | skipped | — | — | — | — | architecture unavailable on ARM64 |

Startup includes a first image pull for Virtuoso and Oxigraph, but Fuseki used an already-built image; the values therefore must not be used as a normalized performance comparison. Docker Desktop did not expose an exact named-volume byte count without privileged volume access, so that metric is recorded as unavailable rather than estimated. Raw CPU, memory, block I/O and network observations remain in the private temporary result JSON files.

All portable Wikibase semantic assertions passed before and after restart. Virtuoso required HTTP Digest for mutation and a fixed managed named graph projected as the query default graph; these differences remain inside its adapter configuration. The three executable profiles also passed isolated named-graph replacement, export, snapshot rebuild, and reset.
