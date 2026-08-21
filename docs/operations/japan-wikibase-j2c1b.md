# J2-C1b standalone promotion lifecycle

The standalone Virtuoso product uses one fixed A/B lifecycle coordinator. The
commands `jwb:promote` and `jwb:rollback` infer the non-serving or retained slot,
the pointer version, and the durable journal. They accept no generation, URL,
SQL, or force arguments.

Promotion phases are `PREPARING`, `POINTER_UPDATED`, `ROUTER_VERIFIED`, and
`GENERATION_FINALIZED`. Pointer CAS and its journal phase commit atomically.
Recovery always resumes the oldest pending journal before considering a prior
completed operation idempotent. A crash before CAS leaves the old pointer
unchanged; a crash after CAS leaves the new pointer authoritative and finalizes
the registry after Router observation. Repeated completion returns the same
journal without another pointer increment.

Only a READY/VALID/CURRENT candidate with CURRENT schema, source-head catch-up,
canonical normalization/partition models, a generation manifest and validation
checksum may be promoted. Rollback uses the same boundary and requires the
retained slot to be caught up and canonical-equal before it is made READY.

The old generation becomes `RETIRING` plus `ROLLBACK` protection, which means
retained rollback storage in the v0.1 product. No automatic physical retirement,
volume deletion, or M10 deletion driver is called. Both workers remain active so
the retained slot follows source changes; equality is still checked immediately
before rollback.

Bounded request-boundary sampling observed only complete old or complete new
Datasets for A/B promotion and rollback. The public endpoint stayed
`http://127.0.0.1:8290/sparql`. Public runtime discovery continues to expose only
the serving generation; `jwb:status` separately reports pointer, rollback slot,
generation sync/schema/validation state, and the last safe journal.
