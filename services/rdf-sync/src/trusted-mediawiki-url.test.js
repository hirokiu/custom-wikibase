import assert from "node:assert/strict";
import test from "node:test";
import { trustedMediaWikiUrl } from "./trusted-mediawiki-url.js";
test("allows only loopback and the fixed disposable Kubernetes Wikibase",()=>{assert.equal(trustedMediaWikiUrl("http://127.0.0.1:8180").hostname,"127.0.0.1");assert.equal(trustedMediaWikiUrl("http://japan-wikibase.jwb-instance-local-01.svc.cluster.local/api.php",{api:true}).pathname,"/api.php");assert.throws(()=>trustedMediaWikiUrl("https://utirik.example/api.php",{api:true}),/allowlist/u);assert.throws(()=>trustedMediaWikiUrl("http://foreign.default.svc.cluster.local/api.php",{api:true}),/allowlist/u);});
