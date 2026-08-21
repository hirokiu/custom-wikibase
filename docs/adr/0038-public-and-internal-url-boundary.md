# ADR-0038: Public identity and trusted internal source URLs

Status: Accepted

## Context

Wikibase RDF uses the MediaWiki server URL as semantic identity. RDF workers,
however, should retrieve RecentChanges and `Special:EntityData` over a private,
bounded service route. Reusing one URL for both concerns breaks either canonical
HTTPS identity or internal reachability and made K2 loopback redirects fail
closed as `ENTITY_RDF_REDIRECT_UNTRUSTED`.

## Decision

The product has three explicit URL settings:

- `canonicalPublicUrl`: the external MediaWiki origin and RDF IRI base;
- `trustedInternalSourceUrl`: an HTTP-only allowlisted Wikibase service used by
  Source Reader and synchronization workers;
- `publicQueryUrl`: the external logical Query Router `/sparql` endpoint.

Runtime discovery publishes only the canonical MediaWiki/API URLs and public
logical query URL. It never publishes the internal source URL. An EntityData
redirect is followed only when its origin exactly matches
`canonicalPublicUrl`, its path and revision query match the requested entity,
and it has no credentials or fragment. The fetch is then rewritten to
`trustedInternalSourceUrl`; arbitrary redirect destinations remain rejected.

Compose retains loopback public defaults and the `wikibase` service internally.
Kubernetes may use `wikibase.<namespace>.svc.cluster.local` internally while
publishing an HTTPS Ingress origin. The chart does not derive or accept an
arbitrary internal hostname.

## Consequences

Ingress, TLS, and DNS no longer alter the RDF worker's network path, while RDF
identity remains stable and externally meaningful. Changing
`canonicalPublicUrl` after data exists is an RDF identity migration and requires
an explicit rebuild; it is not an ordinary endpoint update.
