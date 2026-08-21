# ADR-0037: Standalone Compose uses fixed RDF generation slots

Status: accepted for J2-A foundation

## Decision

Japan Wikibase standalone Compose uses two predeclared physical backend slots,
`backend-a` and `backend-b`, represented logically as `gen-a` and `gen-b`.
Compose creates services and named volumes. Application containers never invoke
Docker, mount the Docker socket or create physical generations.

The worker resolves the selected allowlisted backend and generation slot to a
fixed internal service DNS endpoint through `StandaloneComposeGenerationBackend`.
Backend admin/update ports remain on the internal `backend-private` network.
Only MediaWiki and the logical Query Router are published to `127.0.0.1`.

Host qualification retains `LocalComposeGenerationDriver`; Kubernetes retains
its structured dynamic generation driver. These physical adapters implement
the same logical snapshot, catch-up, validation and serving-cutover concepts.

Automatic physical generation retirement is not wired into the standalone
v0.1 product. The non-serving slot is retained and may be reset only as part of
a later qualified rebuild workflow.
