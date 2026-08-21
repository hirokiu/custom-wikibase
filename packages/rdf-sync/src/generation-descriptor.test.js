import assert from "node:assert/strict";
import test from "node:test";
import { validateGenerationDescriptor } from "./generation-descriptor.js";

test("generation descriptor is structured and local", () => {
  const value = validateGenerationDescriptor({
    generationId: "gen-a",
    sourceIdentity: "jwb-local",
    backendType: "virtuoso",
    normalizationModel: "jwb-rdf-normalization-v1",
    partitionModel: "jwb-partition-v1",
    queryEndpoint: {
      url: "http://127.0.0.1:19190/sparql",
      access: "internal-read",
    },
    internalUpdateEndpoint: {
      url: "http://127.0.0.1:19190/sparql-auth",
      access: "internal-write",
    },
  });
  assert.equal(value.partitionModel, "jwb-partition-v1");
  assert.throws(
    () =>
      validateGenerationDescriptor({
        ...value,
        queryEndpoint: { url: "http://utirik/sparql", access: "internal-read" },
      }),
    /local/u,
  );
});
test("accepts only fixed disposable Kubernetes generation service names",()=>{const base={generationId:"gen-a",sourceIdentity:"jwb-local",backendType:"virtuoso",normalizationModel:"jwb-rdf-normalization-v1",partitionModel:"jwb-partition-v1"};assert.equal(validateGenerationDescriptor({...base,queryEndpoint:{url:"http://rdf-virtuoso-gen-a.jwb-query-local.svc.cluster.local:8890/sparql",access:"internal-read"},internalUpdateEndpoint:{url:"http://rdf-virtuoso-gen-a.jwb-query-local.svc.cluster.local:8890/sparql-auth",access:"internal-write"}}).generationId,"gen-a");assert.throws(()=>validateGenerationDescriptor({...base,queryEndpoint:{url:"http://rdf-virtuoso-gen-a.prod.svc.cluster.local:8890/sparql",access:"internal-read"},internalUpdateEndpoint:{url:"http://127.0.0.1:1/update",access:"internal-write"}}),/local/u);});
test("accepts only fixed standalone A/B backend service names",()=>{const base={generationId:"gen-a",sourceIdentity:"jwb-standalone",backendType:"virtuoso",normalizationModel:"jwb-rdf-normalization-v1",partitionModel:"jwb-partition-v1",queryEndpoint:{url:"http://backend-a:8890/sparql",access:"internal-read"},internalUpdateEndpoint:{url:"http://backend-a:8890/sparql-auth",access:"internal-write"}};assert.equal(validateGenerationDescriptor(base).queryEndpoint.url,"http://backend-a:8890/sparql");assert.throws(()=>validateGenerationDescriptor({...base,queryEndpoint:{...base.queryEndpoint,url:"http://backend-c:8890/sparql"}}),/local/u);});
