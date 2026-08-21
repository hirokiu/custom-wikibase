# Known limitations

[日本語](known-limitations.ja.md)

- Automatic physical RDF generation deletion is disabled.
- Retained rollback is represented by `RETIRING + ROLLBACK`.
- Hot rollback duplicates the update cost across the A/B generation slots.
- There is no production backup/restore contract.
- Oxigraph `optimize` is not automated.
- Large-scale, high-concurrency, and production-sizing benchmarks have not been completed.
- Kubernetes product qualification has not been completed.
- Controller integration has not been completed.
- AMD64 runtime qualification remains pending.
- Canonical hostname migration is not supported.
- Third-party NOTICE and redistribution conditions still require final human review.

Original Custom Wikibase documentation is licensed under CC BY 4.0. Upstream-derived material retains its respective upstream license; see [documentation licensing](../LICENSING.md).

For these reasons, `0.1.0-rc.1` is a local standalone release candidate and is not a production-readiness declaration.
