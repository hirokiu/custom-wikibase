import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MemorySyncRepository } from "../../../packages/rdf-sync/src/state.js";
import { RdfSyncEngine } from "./sync-engine.js";
class Metrics {
  constructor() {
    this.v = new Map();
  }
  increment(k) {
    this.v.set(k, (this.v.get(k) ?? 0) + 1);
  }
  observe(k, v) {
    this.v.set(k, v);
  }
}
class Backend {
  constructor() {
    this.graphs = new Map();
    this.writes = 0;
  }
  async replaceNamedGraph(v) {
    this.graphs.set(v.graphIri, await readFile(v.source, "utf8"));
    this.writes++;
  }
  async deleteNamedGraph(v) {
    this.graphs.delete(v.graphIri);
    this.writes++;
  }
  async query(q) {
    const id = q.match(/entity:([QP]\d+)/u)?.[1],
      revision = q.match(/STR\(\?version\) = "(\d+)"/u)?.[1];
    return {
      boolean:
        this.graphs
          .get(`urn:jwb:entity:${id}`)
          ?.includes(`version> "${revision}"`) ?? false,
    };
  }
}
const rdf = (id, revision) =>
  `<http://www.wikidata.org/entity/${id}> <http://schema.org/version> "${revision}" .\n`;
function fixture(events = []) {
  const repository = new MemorySyncRepository("local");
  const backend = new Backend(),
    metrics = new Metrics();
  const engine = new RdfSyncEngine({
    source: { sourceIdentity: "local", read: async () => ({ events }) },
    repository,
    fetcher: {
      fetch: async (id, revision) => ({
        entityId: id,
        revision,
        rdf: rdf(id, revision),
      }),
    },
    partitioner: { partition: (v) => ({ entityRdf: v.rdf, schemaRdf: "" }) },
    backend,
    resolver: { resolve: async () => ({ unambiguous: false }) },
    rebuildCoordinator: {},
    metrics,
    logger: { log() {} },
    backendType: "test",
  });
  return { engine, repository, backend, metrics };
}
const event = (rcid, revid, oldRevid) => ({
  rcid,
  timestamp: `2026-08-19T00:00:${String(rcid).padStart(2, "0")}Z`,
  type: oldRevid ? "edit" : "new",
  title: "Item:Q1",
  revid,
  oldRevid,
});
test("long-running poll applies and persists an entity only after verified graph write", async () => {
  const f = fixture([event(1, 20, 0)]);
  await f.engine.pollOnce();
  assert.equal((await f.repository.loadEntity("Q1")).indexedRevision, 20);
  assert.equal((await f.repository.loadSource()).cursor.rcid, 1);
  assert.equal(f.backend.writes, 1);
});
test("20,21,21,20,22 produces three writes and monotonic fence", async () => {
  const f = fixture();
  for (const e of [
    event(1, 20, 0),
    event(2, 21, 20),
    event(3, 21, 20),
    event(4, 20, 19),
    event(5, 22, 21),
  ])
    await f.engine.processEvent(e);
  assert.equal((await f.repository.loadEntity("Q1")).indexedRevision, 22);
  assert.equal(f.backend.writes, 3);
  assert.equal(f.metrics.v.get("duplicate_events_total"), 1);
  assert.equal(f.metrics.v.get("out_of_order_events_total"), 1);
});
test("gap fails closed without backend write or cursor advancement", async () => {
  const f = fixture();
  await f.engine.processEvent(event(1, 20, 0));
  await f.engine.processEvent(event(2, 22, 21));
  assert.equal(f.backend.writes, 1);
  assert.equal((await f.repository.loadSource()).status, "REBUILD_REQUIRED");
  assert.equal((await f.repository.loadSource()).cursor.rcid, 1);
});
for (const point of [
  "AFTER_RDF_FETCH",
  "BEFORE_BACKEND_UPDATE",
  "AFTER_BACKEND_UPDATE",
  "BEFORE_FENCE_COMMIT",
  "AFTER_FENCE_BEFORE_CURSOR",
])
  test(`restart is safe at ${point}`, async () => {
    const f = fixture();
    await f.engine.processEvent(event(1, 20, 0), { crashAt: point });
    const source = await f.repository.loadSource(),
      entity = await f.repository.loadEntity("Q1");
    if (["AFTER_FENCE_BEFORE_CURSOR"].includes(point))
      assert.equal(entity.indexedRevision, 20);
    else assert.equal(entity.indexedRevision, 0);
    assert.equal(source.cursor, null);
    assert.equal(source.status, "REBUILD_REQUIRED");
  });
test("delete removes only entity graph and repeated delete is safe", async () => {
  const f = fixture();
  await f.engine.processEvent(event(1, 20, 0));
  const deletion = {
    rcid: 2,
    timestamp: "2026-08-19T00:00:02Z",
    type: "log",
    title: "Item:Q1",
    revid: 0,
    oldRevid: 0,
    logtype: "delete",
    logaction: "delete",
  };
  await f.engine.processEvent(deletion);
  await f.engine.processEvent({
    ...deletion,
    rcid: 3,
    timestamp: "2026-08-19T00:00:03Z",
  });
  assert.equal((await f.repository.loadEntity("Q1")).status, "DELETED");
  assert.equal(f.backend.graphs.size, 0);
});
test("undelete rematerializes a tombstoned graph when MediaWiki reuses the old revision",async()=>{const repository=new MemorySyncRepository('local'),backend=new Backend(),metrics=new Metrics(),engine=new RdfSyncEngine({source:{sourceIdentity:'local'},repository,fetcher:{fetch:async(id,revision)=>({entityId:id,revision,rdf:rdf(id,revision)})},partitioner:{partition:value=>({entityGraphIri:'urn:jwb:entity:Q1',entityRdf:value.rdf,schemaRdf:''})},backend,resolver:{resolve:async()=>({unambiguous:true,entities:[{id:'Q1',revision:20,deleted:false}]})},rebuildCoordinator:{},metrics,logger:{log(){}},backendType:'test'});await engine.processEvent(event(1,20,0));const deletion={rcid:2,timestamp:'2026-08-19T00:00:02Z',type:'log',title:'Item:Q1',revid:0,oldRevid:0,logtype:'delete',logaction:'delete'};await engine.processEvent(deletion);assert.equal((await repository.loadEntity('Q1')).status,'DELETED');const restore={...deletion,rcid:3,timestamp:'2026-08-19T00:00:03Z',logaction:'restore'};assert.equal(await engine.processEvent(restore),'LIFECYCLE_APPLIED');assert.equal((await repository.loadEntity('Q1')).indexedRevision,20);assert.equal((await repository.loadEntity('Q1')).status,'CURRENT');assert.ok(backend.graphs.has('urn:jwb:entity:Q1'));assert.equal(await engine.processEvent({...restore,rcid:4,timestamp:'2026-08-19T00:00:04Z'}),'LIFECYCLE_APPLIED');assert.ok(backend.graphs.has('urn:jwb:entity:Q1'));});
test("Property edit and deletion maintain entity/schema graphs and schema currency together", async () => {
  const repository = new MemorySyncRepository("local");
  const backend = new Backend(),
    metrics = new Metrics();
  const engine = new RdfSyncEngine({
    source: { sourceIdentity: "local" },
    repository,
    fetcher: {
      fetch: async (id, revision) => ({
        entityId: id,
        revision,
        rdf: rdf(id, revision),
      }),
    },
    partitioner: {
      partition: (v) => ({
        entityGraphIri: "urn:jwb:entity:P7",
        entityRdf: v.rdf,
        schemaGraphIri: "urn:jwb:schema:P7",
        schemaRdf: '<urn:schema> <urn:version> "20" .\n',
      }),
    },
    backend,
    resolver: {},
    rebuildCoordinator: {},
    metrics,
    logger: { log() {} },
    backendType: "test",
  });
  const edit = {
    rcid: 1,
    timestamp: "2026-08-19T00:00:01Z",
    type: "new",
    title: "Property:P7",
    revid: 20,
    oldRevid: 0,
  };
  assert.equal(await engine.processEvent(edit), "APPLIED");
  assert.deepEqual([...repository.graphs].sort(), [
    "urn:jwb:entity:P7",
    "urn:jwb:schema:P7",
  ]);
  assert.equal(repository.schemaState, "CURRENT");
  assert.equal(backend.graphs.size, 2);
  const deletion = {
    rcid: 2,
    timestamp: "2026-08-19T00:00:02Z",
    type: "log",
    title: "Property:P7",
    revid: 0,
    oldRevid: 0,
    logtype: "delete",
    logaction: "delete",
  };
  assert.equal(await engine.processEvent(deletion), "DELETED");
  assert.equal(backend.graphs.size, 0);
  assert.equal(repository.graphs.size, 0);
});
