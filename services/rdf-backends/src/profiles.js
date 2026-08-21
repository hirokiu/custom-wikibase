const base = {
  sparql11Query: true, sparql11Update: true, namedGraphs: true,
  transactionalUpdate: false, graphStoreProtocol: true, serviceFederation: false,
  fullTextSearch: false, geoSparql: false, wikibaseLabelService: false,
  isolatedGenerations: false, atomicServingCutover: false, rollbackCutover: false,
  generationDelete: false, generationQuery: false
};

export const RDF_BACKEND_PROFILES = Object.freeze({
  'fuseki-tdb2': Object.freeze({ backendType: 'fuseki-tdb2', capabilities: Object.freeze({ ...base, transactionalUpdate: true, serviceFederation: true }) }),
  oxigraph: Object.freeze({ backendType: 'oxigraph', capabilities: Object.freeze({ ...base, transactionalUpdate: true, serviceFederation: true }) }),
  virtuoso: Object.freeze({ backendType: 'virtuoso', capabilities: Object.freeze({ ...base, serviceFederation: true, fullTextSearch: true }) }),
  'blazegraph-wdqs': Object.freeze({ backendType: 'blazegraph-wdqs', capabilities: Object.freeze({ ...base, graphStoreProtocol: false, wikibaseLabelService: true }) })
});
