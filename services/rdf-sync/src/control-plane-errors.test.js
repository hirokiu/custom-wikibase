import assert from 'node:assert/strict';import test from 'node:test';
import{ControlPlaneError,eligibilityError}from'./control-plane-errors.js';
test('eligibility reasons map to stable public codes',()=>{assert.equal(eligibilityError(['PROMOTION_INCOMPLETE']).code,'INCOMPLETE_PROMOTION');assert.equal(eligibilityError(['ROLLBACK_PROTECTED']).code,'ROLLBACK_GENERATION_PROTECTED');assert.equal(eligibilityError(['SYNC_ACTIVE']).code,'RETIREMENT_WAITING_ELIGIBILITY');});
test('unsafe or unknown error contracts fail closed',()=>{assert.throws(()=>new ControlPlaneError('RAW_ERROR'),/invalid/u);assert.throws(()=>new ControlPlaneError('ROUTER_NOT_CONVERGED',{raw:{secret:true}}),/invalid/u);});
