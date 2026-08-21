# M10E control-plane closure

The normal generation lifecycle is `GenerationCoordinatorRuntime` backed by
`PostgresGenerationCoordinatorRepository`. `PostgresServingPointerRepository.promote`
is an internal persistence primitive retained only for historical M7-M9 isolated
tests; M10 and later runtime or qualification code must create a `PROMOTION`
Coordinator operation.

Retirement requests are durable while protected. `WAITING_ELIGIBILITY` grants no
delete token and invokes no Kubernetes driver. Promotion rotates protection in one
transaction: the candidate becomes `SERVING`, the prior serving generation becomes
`ROLLBACK`, and the older rollback generation becomes unprotected. Pending
retirements are then re-evaluated by a fenced Coordinator claim. A new incomplete
promotion is the valid reverse case for an otherwise eligible request: the request
returns to/remains waiting and no token is issued. There is intentionally no generic
protection setter.

Destructive authorization identity is `(operation_id, operation_fence,
deletion_token)`. An exact retry returns the persisted token. A takeover fence gets
a new token and keeps older attempts as historical evidence; old evidence is never
promoted to the new fence.

`rdf_generation_delete_attempt` is authoritative. Its successful lifecycle is
`PLANNED -> FENCE_MARKED -> DELETE_INTENT -> DELETE_ACCEPTED -> ABSENT_CONFIRMED`.
An accepted Kubernetes DELETE is not absence. The driver observes the expected UID;
a replacement with a different UID proves only that the old object is absent and is
never deleted by the old plan. A terminating expected UID remains pending until its
finalizers complete or the bounded observation times out.

The generation Service is the authority object. Unlike the StatefulSet, it remains
available after workload deletion and can therefore fence the final PVC boundary.
It carries only the fixed retirement operation, fence, and token annotations and is
deleted last. PostgreSQL authority and the Service marker are checked before the
first DELETE and again before PVC deletion. Plans are immutable, driver-branded,
UID/resourceVersion-bound objects and cannot be supplied as plain caller objects.

The post-preflight crash boundary occurs after DB authorization, all-resource plan
persistence, Service marker CAS, and `FENCE_MARKED`, but before the first
`DELETE_INTENT`. Recovery must reclaim the operation and create a new token when the
fence changes, then re-plan and re-mark; it cannot execute an old in-memory plan.

Lease eligibility, expiry, renewal, and destructive entry use PostgreSQL `now()`.
Authorization renews to at least the configured repository lease interval before
preflight. That interval fences entry rather than the entire asynchronous deletion.

Coordinator readiness validates the checksum of migration 013 and its required
tables/columns without running migrations. The packaged migration Job remains the
only migration writer. Coordinator Pods may start earlier, but remain unready and do
not enter their operation loop until the Job-applied schema passes this gate; no
timing or sleep grants readiness.

PVC `ABSENT_CONFIRMED` means only that the PVC API object with the expected UID is
gone. It does not claim immediate destruction of a PV, storage medium, or detached
volume. Those require separate StorageClass, reclaim-policy, finalizer, PV, and
VolumeAttachment observations in the packaged qualification.
