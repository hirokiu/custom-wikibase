# ADR-0019: Japan Wikibase core remains independent of a query backend

Status: Accepted

MediaWiki with Wikibase Repository is the canonical source of entity data. A query service is an optional, derived-data component: a Japan Wikibase instance must remain usable for entity reads and writes when no SPARQL backend is configured or while its index is unavailable. No RDF store may be used to update or reconstruct canonical Wikibase entities automatically.

Apple Silicon (`linux/arm64`) is a first-class local development target. Core images and required dependencies must have a validated native ARM64 path; emulation-only components may be used only in an explicitly marked compatibility profile. Japanese language defaults and research customizations belong in a replaceable configuration layer rather than a fork of MediaWiki or Wikibase.

The existing Wikibase Suite deployment and its WDQS/Blazegraph components remain supported as a compatibility profile for imported and existing instances. This decision does not replace ADR-0008 for those instances. New Core profiles need not install WDQS and must not assume that Blazegraph-specific query behavior exists.

Core packaging, RDF synchronization, query backend operation, and publication are separate concerns. Failure or removal of an optional query backend must not remove MariaDB data, uploads, or Wikibase configuration.
