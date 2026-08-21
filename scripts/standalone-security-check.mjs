import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const excluded = new Set(['.git', 'node_modules']);
const credentialFiles = /(^|\/)(\.env($|\.)|kubeconfig|LocalSettings\.local\.php)|\.(pem|key|p12)$/iu;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
const credentialUrl = /(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s/:]+:[^\s/@]+@/iu;
const assignment = /(?:password|passwd|token|secret|cookie)\s*[:=]\s*["'](?!\$\{|<|example|change|test|dummy|redacted|\[)[^"']{12,}["']/iu;
const findings = [];

function isTestOrLocalTemplate(path, value) {
  return /(?:\.test\.js$|scripts\/jwb-m(?:9|10)|scripts\/jwb-.*qualification)/u.test(path)
    || value.includes('${')
    || /(?:127\.0\.0\.1|localhost|@postgres(?::|\/))/u.test(value);
}

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (excluded.has(entry)) continue;
    const absolute = resolve(directory, entry);
    const path = relative(root, absolute);
    const status = statSync(absolute);
    if (status.isDirectory()) visit(absolute);
    else if (credentialFiles.test(path)) findings.push({ path, reason: 'credential-bearing filename' });
    else if (status.size <= 5_000_000) {
      const value = readFileSync(absolute, 'utf8');
      if (privateKey.test(value)) findings.push({ path, reason: 'private key' });
      if (credentialUrl.test(value) && !isTestOrLocalTemplate(path, value)) findings.push({ path, reason: 'credential URL' });
      if (assignment.test(value) && !isTestOrLocalTemplate(path, value)) findings.push({ path, reason: 'literal credential assignment' });
    }
  }
}

visit(root);
if (findings.length) {
  console.error(JSON.stringify({ status: 'FAILED', findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: 'PASS', credentialBearingCandidateFiles: 0 }));
}
