# ADR-0021: Wikidata publication is separate from RDF indexing

Status: Accepted

Publishing selected Japan Wikibase data to Wikidata is a distinct, explicitly authorized workflow. RDF synchronization and backend adapters cannot publish, edit, or authenticate to Wikidata. An RDF dump is an indexing and exchange representation, not a Wikidata editing plan.

Local `Q` and `P` identifiers belong to the local repository and have no implied equality with identically numbered Wikidata entities or properties. Publication requires versioned item and property mappings, datatype and policy validation, a reviewable immutable preview, and explicit human approval. Mapping provenance and approval events must be auditable.

Phase 1 provides only the domain boundary and may later provide offline preview or export artifacts. It does not store Wikidata credentials or execute publication. A future publication adapter requires a separate security review, target allowlist, credential boundary, rate and retry policy, idempotency design, and an approved test environment before any external write is enabled.
