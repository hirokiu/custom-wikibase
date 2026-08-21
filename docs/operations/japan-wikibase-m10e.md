# Japan Wikibase M10E retirement safety contract

M10E changes only destructive generation retirement. It does not qualify M10D
and does not change RDF synchronization.

The executable lifecycle is:

`SERVING -> RETIRING + ROLLBACK -> explicit/rotated release -> RETIREMENT_IN_PROGRESS -> RETIRED -> PHYSICAL_DELETE_PENDING -> PHYSICALLY_DELETED -> METADATA_FINALIZED`.

Cleanup scheduling records pointer and generation versions. A claimed
Coordinator must revalidate those facts and its lease/fence to obtain a fresh
deletion token. The driver then performs a full StatefulSet/Service/PVC
ownership and identity preflight, re-reads all resources, and deletes in that
order with Kubernetes UID/resourceVersion preconditions. Progress is recorded
after every deletion; resources already absent on retry are recorded without
being recreated.

Local PostgreSQL verification uses `npm run test:postgres`. Unit and repository
checks remain part of `npm run check`. No M10D command is invoked by either.
