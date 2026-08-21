#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { JWB_BASE_URL } from './jwb-lib.mjs';

const path = new URL('../artifacts/jwb-m3/mutation-observations.json', import.meta.url).pathname;
const observations = JSON.parse(readFileSync(path, 'utf8'));
const url = new URL('/api.php', JWB_BASE_URL);
for (const [key, value] of Object.entries({ action: 'query', list: 'recentchanges', rclimit: '100', rcprop: 'title|ids|timestamp|flags|loginfo', format: 'json', formatversion: '2' })) url.searchParams.set(key, value);
const response = await fetch(url);
if (!response.ok) throw new Error(`RecentChanges HTTP ${response.status}`);
const changes = (await response.json()).query.recentchanges;
observations.recentChanges = observations.mutations.map((mutation) => {
  const rc = changes.find((entry) => entry.revid === mutation.revision) ?? {};
  return { mutation: mutation.id, title: rc.title, rcid: rc.rcid, revid: rc.revid, oldRevid: rc.old_revid, type: rc.type, timestamp: rc.timestamp, logtype: rc.logtype, logaction: rc.logaction, redirect: Boolean(rc.redirect) };
});
writeFileSync(path, `${JSON.stringify(observations, null, 2)}\n`, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(`mapped ${observations.recentChanges.filter((entry) => entry.revid).length} mutation revisions to RecentChanges`);
