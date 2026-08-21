# ADR-0036: Platform and Japan Wikibase PostgreSQL ownership is separate

Status: accepted for J1 boundary preparation

## Decision

Federated Platform PostgreSQL and Japan Wikibase PostgreSQL are separate
ownership domains. They use separate database names, roles and migration
authorities even when an operator places them in the same PostgreSQL cluster.

Current migrations 001 through 004 belong to the Platform. They contain users,
roles, hosts, instances, endpoints, observations, platform operations, import
state and reconciliation leases/fences.

Current migrations 005 through 013 belong to Japan Wikibase. They contain RDF
source cursors, revision fences, synchronization state, generation registry and
manifests, query-service and serving-pointer state, promotion, protection and
retirement journals, and resource deletion attempts.

J1 does not renumber migrations, move tables or perform a physical database
migration. A later repository-boundary change will give each product its own
migration package while preserving the applied migration identity.

## Access rules

- Platform runtime code never queries Japan Wikibase PostgreSQL directly.
- Japan Wikibase runtime code never queries Platform PostgreSQL directly.
- Platform integration uses `jwb-runtime-v1`, not serving-pointer repositories.
- Database credentials, internal update endpoints and journals are not exposed
  by the runtime contract.
- Core-only Japan Wikibase does not require PostgreSQL.

## Consequences

The current mixed `packages/database` is transitional. Cross-product joins,
shared roles and coordinated migrations are forbidden. Backup, restore and
upgrade ownership follows the product that owns the database.
