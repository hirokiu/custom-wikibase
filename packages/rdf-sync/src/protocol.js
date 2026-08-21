const ENTITY_ID = /^[QP][1-9][0-9]*$/u;
export const EVENT_ACTIONS = Object.freeze(['ENTITY_EDIT','ENTITY_DELETE','ENTITY_UNDELETE','ENTITY_REDIRECT','ENTITY_REDIRECT_REMOVED','ENTITY_MERGE','NON_ENTITY_CHANGE','UNKNOWN']);
export const SYNC_STATES = Object.freeze(['BOOTSTRAPPING','HEALTHY','CATCHING_UP','STALE','GAP_DETECTED','REBUILD_REQUIRED','REBUILDING','ERROR']);

/** @param {{sourceIdentity:string,timestamp:string,rcid:number}} value */
export function validateCursor(value) {
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(value?.sourceIdentity)) throw new Error('invalid source identity');
  if (!Number.isInteger(value.rcid) || value.rcid < 0) throw new Error('invalid rcid');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.timestamp) || Number.isNaN(Date.parse(value.timestamp))) throw new Error('invalid cursor timestamp');
  return Object.freeze({ sourceIdentity: value.sourceIdentity, timestamp: value.timestamp, rcid: value.rcid });
}
/** @param {object} left @param {object} right */
export function compareCursor(left, right) { const a=validateCursor(left), b=validateCursor(right); if(a.sourceIdentity!==b.sourceIdentity) throw new Error('cursor source mismatch'); return a.timestamp===b.timestamp ? Math.sign(a.rcid-b.rcid) : Math.sign(a.timestamp.localeCompare(b.timestamp)); }

/** Authoritative log metadata wins; ambiguous lifecycle events fail closed. */
export function classifyChange(event) {
  const title = String(event?.title ?? '');
  const entity = title.match(/^(?:Item|Property):([QP][1-9][0-9]*)$/u)?.[1] ?? null;
  if (event?.type === 'log') {
    const key = `${event.logtype ?? ''}/${event.logaction ?? ''}`;
    const actions = { 'delete/delete':'ENTITY_DELETE', 'delete/restore':'ENTITY_UNDELETE', 'merge/merge':'ENTITY_MERGE' };
    if (actions[key]) return Object.freeze({ action: actions[key], entityId: entity, authoritative: true });
    return Object.freeze({ action: entity ? 'UNKNOWN' : 'NON_ENTITY_CHANGE', entityId: entity, authoritative: false });
  }
  if (!entity) return Object.freeze({ action: 'NON_ENTITY_CHANGE', entityId: null, authoritative: false });
  if (event.type !== 'edit' && event.type !== 'new') return Object.freeze({ action: 'UNKNOWN', entityId: entity, authoritative: false });
  const tags=Array.isArray(event.tags)?event.tags:[]; const comment=String(event.comment??'');
  if(tags.includes('mw-removed-redirect'))return Object.freeze({action:'ENTITY_REDIRECT_REMOVED',entityId:entity,authoritative:true});
  if(tags.includes('mw-new-redirect')||comment.startsWith('/* wbcreateredirect:'))return Object.freeze({action:'ENTITY_REDIRECT',entityId:entity,authoritative:true});
  if(comment.startsWith('/* wbmergeitems-'))return Object.freeze({action:'ENTITY_MERGE',entityId:entity,authoritative:true});
  // rcprop=redirect describes current page state, so it can rewrite the meaning of old RC rows.
  if (event.redirect === true) return Object.freeze({ action: 'UNKNOWN', entityId: entity, authoritative: false });
  return Object.freeze({ action: 'ENTITY_EDIT', entityId: entity, authoritative: true });
}

export class RevisionFence {
  constructor(entityId, indexedRevision=0) { if(!ENTITY_ID.test(entityId)||!Number.isInteger(indexedRevision)||indexedRevision<0) throw new Error('invalid fence'); this.entityId=entityId; this.indexedRevision=indexedRevision; this.latestSeenRevision=indexedRevision; this.status='HEALTHY'; }
  observe(incomingRevision, oldRevision) {
    if(!Number.isInteger(incomingRevision)||incomingRevision<1) throw new Error('invalid incoming revision');
    this.latestSeenRevision=Math.max(this.latestSeenRevision,incomingRevision);
    if(incomingRevision<=this.indexedRevision) return {decision: incomingRevision===this.indexedRevision?'DUPLICATE':'OLDER',write:false};
    if(this.indexedRevision!==0 && oldRevision!==this.indexedRevision) { this.status='GAP_DETECTED'; return {decision:'GAP_DETECTED',write:false}; }
    return {decision:'APPLY',write:true};
  }
  commit(revision) { if(revision<=this.indexedRevision||revision>this.latestSeenRevision) throw new Error('invalid fence commit'); this.indexedRevision=revision; this.status='HEALTHY'; }
  fail(code='BACKEND_WRITE_FAILED') { this.status='ERROR'; return {code}; }
}

export class InMemorySyncStore {
  constructor(sourceIdentity) { this.sourceIdentity=sourceIdentity; this.cursor=null; this.entities=new Map(); }
  fence(entityId) { if(!this.entities.has(entityId)) this.entities.set(entityId,new RevisionFence(entityId)); return this.entities.get(entityId); }
  advanceCursor(cursor) { const next=validateCursor(cursor); if(next.sourceIdentity!==this.sourceIdentity) throw new Error('cursor source mismatch'); if(this.cursor&&compareCursor(next,this.cursor)<=0) return false; this.cursor=next; return true; }
}

const ignorePhase = (_phase) => {};

/**
 * Executes one update with the fence last. Injected hooks make every crash point testable.
 * @param {{event:{entityId:string,revid:number,oldRevid:number},fence:RevisionFence,fetchEntity:(entityId:string,revision:number)=>Promise<{revision:number}>,stage:(fetched:{revision:number})=>Promise<unknown>,commitGraph:(staged:unknown)=>Promise<void>,verify:(fetched:{revision:number})=>Promise<boolean>,onPhase?:(phase:string)=>void}} input
 */
export async function applyEntityProtocol({event,fence,fetchEntity,stage,commitGraph,verify,onPhase=ignorePhase}) {
  onPhase('BEFORE_FETCH');
  const decision=fence.observe(event.revid,event.oldRevid);
  if(!decision.write) return decision;
  const fetched=await fetchEntity(event.entityId,event.revid); onPhase('AFTER_FETCH');
  if(fetched.revision!==event.revid) return {decision:'REVISION_MISMATCH',write:false,rebuild:true};
  onPhase('BEFORE_BACKEND_UPDATE'); const staged=await stage(fetched); onPhase('DURING_BACKEND_UPDATE');
  await commitGraph(staged); onPhase('AFTER_BACKEND_UPDATE');
  if(!(await verify(fetched))) { fence.fail('VERIFY_FAILED'); return {decision:'VERIFY_FAILED',write:true,rebuild:true}; }
  fence.commit(event.revid); onPhase('AFTER_FENCE_UPDATE');
  return {decision:'APPLIED',write:true};
}

export class ChangeSource {
  /** @returns {Promise<any>} */
  read(_cursor,_limit){ return Promise.reject(new Error('ChangeSource.read is not implemented')); }
}
export class EntityRdfFetcher {
  /** @returns {Promise<any>} */
  fetch(_entityId,_revision){ return Promise.reject(new Error('EntityRdfFetcher.fetch is not implemented')); }
}
export class RdfPartitioner { /** @returns {unknown} */ partition(_rdf){ throw new Error('RdfPartitioner.partition is not implemented'); } }
