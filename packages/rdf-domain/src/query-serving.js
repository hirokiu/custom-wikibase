// These guarantees belong to the logical query service, not to an RDF product.
export const QUERY_SERVING_CAPABILITIES = Object.freeze({
  isolatedPhysicalTargets: true,
  requestBoundaryCutover: true,
  compareAndSwapPointer: true,
  rollbackPointer: true,
  multipleRouterConvergence: true,
});
