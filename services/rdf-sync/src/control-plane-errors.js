export const CONTROL_PLANE_ERROR_CODES = Object.freeze(new Set([
  'SERVING_GENERATION_PROTECTED','ROLLBACK_GENERATION_PROTECTED','RETIREMENT_WAITING_ELIGIBILITY',
  'INCOMPLETE_PROMOTION','STALE_POINTER_VERSION','STALE_GENERATION_VERSION','STALE_COORDINATOR_FENCE',
  'OPERATION_LEASE_LOST','RESOURCE_IDENTITY_MISMATCH','RESOURCE_UID_MISMATCH',
  'RESOURCE_VERSION_MISMATCH','RESOURCE_MISSING_UNEXPECTED','RESOURCE_ALREADY_DELETED_BY_OPERATION',
  'PHYSICAL_DELETE_PARTIAL','ROUTER_TARGET_UNRESOLVABLE','ROUTER_NOT_CONVERGED','SCHEMA_MIGRATION_REQUIRED',
]));

export class ControlPlaneError extends Error {
  constructor(code, details = {}) {
    if (!CONTROL_PLANE_ERROR_CODES.has(code) || !safeDetails(details)) throw new Error('invalid control-plane error');
    super(code); this.name='ControlPlaneError'; this.code=code; this.details=Object.freeze({...details});
  }
}

export function eligibilityError(reasons, details = {}) {
  const code = reasons.includes('PROMOTION_INCOMPLETE') ? 'INCOMPLETE_PROMOTION'
    : reasons.some(v=>['GENERATION_SERVING','SERVING_PROTECTED','SERVING_POINTER_CURRENT'].includes(v)) ? 'SERVING_GENERATION_PROTECTED'
    : reasons.some(v=>['ROLLBACK_PROTECTED','SERVING_POINTER_PREVIOUS','ROLLBACK_INCOMPLETE'].includes(v)) ? 'ROLLBACK_GENERATION_PROTECTED'
    : 'RETIREMENT_WAITING_ELIGIBILITY';
  return new ControlPlaneError(code,{...details,reasons:[...reasons]});
}
function safeDetails(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;return Object.values(v).every(x=>x===null||typeof x==='string'||typeof x==='number'||typeof x==='boolean'||Array.isArray(x)&&x.every(y=>typeof y==='string'));}
