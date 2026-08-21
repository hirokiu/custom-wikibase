#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeFiles, readProfile } from './jwb-product-lib.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const productRoot = resolve(root, 'infrastructure/japan-wikibase');
const directory = resolve(root, 'artifacts/linux-amd64/failure');
const runtimePath = '/tmp/japan-wikibase-runtime.json';
const startedAt = process.env.JWB_FAILURE_STARTED_AT ?? new Date(Date.now() - 900_000).toISOString();
const completedAt = new Date().toISOString();
mkdirSync(directory, { recursive: true });

const runtime = existsSync(runtimePath) ? JSON.parse(readFileSync(runtimePath, 'utf8')) : null;
const profile = safe(() => readProfile(), null);
const secrets = runtime ? [runtime.databasePassword, runtime.databaseRootPassword, runtime.adminPassword, runtime.secretKey, runtime.upgradeKey, runtime.queryDatabasePassword, runtime.rdfAdminPassword].filter(Boolean) : [];
const migrate = inspect('japan-wikibase-jwb-migrate-1');
const postgres = inspect('japan-wikibase-jwb-postgresql-1');
const migrateLogs = sanitizedDocker(['logs', '--timestamps', '--tail', '400', 'japan-wikibase-jwb-migrate-1']);
const postgresLogs = sanitizedDocker(['logs', '--timestamps', '--tail', '400', 'japan-wikibase-jwb-postgresql-1']);
const structuredError = [...migrateLogs.split('\n')].reverse().find((line) => line.includes('JWB_')) ?? '';
const sourceConfig = (profile ? composeFiles(profile.backend) : ['compose.product.yaml', 'compose.query.yaml']).map((name) => `# ${name}\n${readFileSync(resolve(productRoot, name), 'utf8')}`).join('\n');

write('failure.json', JSON.stringify({ schemaVersion: 1, capturedAt: completedAt, failure: sanitize(process.env.JWB_FAILURE_MESSAGE ?? 'unknown'), migrationExitCode: migrate?.State?.ExitCode ?? null, migrationError: structuredError, postgresHealth: postgres?.State?.Health?.Status ?? null, postgresRestartCount: postgres?.RestartCount ?? null }, null, 2));
write('compose-ps.txt', sanitizedDocker(['ps', '--all', '--filter', 'label=com.docker.compose.project=japan-wikibase', '--format', '{{json .}}']));
write('compose-events.txt', sanitizedDocker(['events', '--since', startedAt, '--until', completedAt, '--filter', 'label=com.docker.compose.project=japan-wikibase', '--format', '{{json .}}']));
write('migrate-inspect.json', JSON.stringify(boundedInspect(migrate), null, 2));
write('migrate-stdout.txt', migrateLogs);
write('migrate-stderr.txt', structuredError);
write('migrate-logs.txt', migrateLogs);
write('postgresql-logs.txt', postgresLogs);
write('postgresql-inspect.json', JSON.stringify(boundedInspect(postgres), null, 2));
write('compose-config.yaml', sourceConfig);
write('timestamps.json', JSON.stringify({ schemaVersion: 1, qualificationStartedAt: startedAt, capturedAt: completedAt }, null, 2));

function inspect(name) { const result = spawnSync('docker', ['inspect', name], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); if (result.status !== 0 || !result.stdout) return null; return JSON.parse(sanitize(result.stdout))[0]; }
function sanitizedDocker(args) { const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return sanitize(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()); }
function boundedInspect(value) { if (!value) return null; return { Id: value.Id, Created: value.Created, Path: value.Path, Args: value.Args, State: value.State, RestartCount: value.RestartCount, Image: value.Image, Name: value.Name }; }
function sanitize(value) { let result = String(value).replace(/postgres(?:ql)?:\/\/[^\s"']+/gu, '[REDACTED_DATABASE_URL]'); for (const secret of secrets) result = result.split(secret).join('[REDACTED]'); return result; }
function write(name, value) { const path = resolve(directory, name); writeFileSync(path, `${value}\n`, { mode: 0o600 }); chmodSync(path, 0o600); }
function safe(operation, fallback) { try { return operation(); } catch { return fallback; } }
