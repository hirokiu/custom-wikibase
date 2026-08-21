import assert from'node:assert/strict';import test from'node:test';import{JWB_MIGRATIONS}from'./jwb-migrations.js';
test('JWB migration ownership is exactly 005 through 013',()=>{assert.deepEqual(JWB_MIGRATIONS.map(v=>v.slice(0,3)),['005','006','007','008','009','010','011','012','013']);assert.equal(JWB_MIGRATIONS.some(v=>/^00[1-4]_/u.test(v)),false);});
