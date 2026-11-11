import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const composeFile = 'infrastructure/local/docker-compose.yml';
const envFile = 'infrastructure/local/.env.local';
const container = `rp-gant-restore-check-${process.pid}`;
const dir = mkdtempSync(join(tmpdir(), 'rp-gant-restore-'));
const databases = [
  'rp_gant_user',
  'rp_gant_project',
  'rp_gant_notification',
  'rp_gant_audit',
  'rp_gant_sync',
];

function commandError(command, result) {
  const detail = result.error?.message ?? result.stderr?.trim() ?? `exit status ${result.status}`;
  return new Error(`${command} failed: ${detail}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0) throw commandError(command, result);
  return result.stdout;
}

function dumpToFile(args, target) {
  const fd = openSync(target, 'w');
  let result;
  try {
    result = spawnSync('docker', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      stdio: ['ignore', fd, 'pipe'],
    });
  } finally {
    closeSync(fd);
  }
  if (result.error || result.status !== 0) throw commandError('docker', result);
}

function restoreFromFile(args, source) {
  const fd = openSync(source, 'r');
  let result;
  try {
    result = spawnSync('docker', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      stdio: [fd, 'ignore', 'pipe'],
    });
  } finally {
    closeSync(fd);
  }
  if (result.error || result.status !== 0) throw commandError('docker', result);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'rp_gant'], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('temporary postgres did not become ready');
}

function count(database, table) {
  return Number(
    run('docker', [
      'exec',
      container,
      'psql',
      '-U',
      'rp_gant',
      '-d',
      database,
      '-Atc',
      `SELECT count(*) FROM ${table}`,
    ]).trim(),
  );
}

function sourceCount(database, table) {
  return Number(
    run('docker', [
      'compose',
      '--env-file',
      envFile,
      '-f',
      composeFile,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'rp_gant',
      '-d',
      database,
      '-Atc',
      `SELECT count(*) FROM ${table}`,
    ]).trim(),
  );
}

const checks = [
  ['rp_gant_user', 'access.users'],
  ['rp_gant_project', 'project.projects'],
  ['rp_gant_project', 'plan.tasks'],
  ['rp_gant_notification', 'notify.notifications'],
  ['rp_gant_audit', 'audit.audit_events'],
  ['rp_gant_sync', 'events.processed_events'],
];

try {
  const expectedCounts = new Map(
    checks.map(([database, table]) => [`${database}.${table}`, sourceCount(database, table)]),
  );
  for (const database of databases) {
    dumpToFile(
      [
        'compose',
        '--env-file',
        envFile,
        '-f',
        composeFile,
        'exec',
        '-T',
        'postgres',
        'pg_dump',
        '-U',
        'rp_gant',
        '--clean',
        '--if-exists',
        database,
      ],
      join(dir, `${database}.sql`),
    );
  }
  for (const [database, table] of checks) {
    const actual = sourceCount(database, table);
    const expected = expectedCounts.get(`${database}.${table}`);
    if (actual !== expected) {
      throw new Error(
        `source changed during backup: ${database}.${table} ${expected} -> ${actual}`,
      );
    }
  }
  console.log('backups created');

  run('docker', [
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_USER=rp_gant',
    '-e',
    'POSTGRES_PASSWORD=rp_gant_dev',
    '-e',
    'POSTGRES_DB=postgres',
    'postgres:17-alpine',
  ]);
  waitForPostgres();

  for (const database of databases) {
    run('docker', ['exec', container, 'createdb', '-U', 'rp_gant', database]);
    restoreFromFile(
      ['exec', '-i', container, 'psql', '-U', 'rp_gant', '-d', database, '-v', 'ON_ERROR_STOP=1'],
      join(dir, `${database}.sql`),
    );
  }
  console.log('restore completed');

  for (const [database, table] of checks) {
    const actual = count(database, table);
    const expected = expectedCounts.get(`${database}.${table}`);
    console.log(`${database}.${table}: ${actual} (source ${expected})`);
    if (actual !== expected) {
      throw new Error(
        `restored count mismatch: ${database}.${table} expected ${expected}, got ${actual}`,
      );
    }
  }
  console.log('restore drill passed');
} finally {
  spawnSync('docker', ['rm', '-f', container], {
    cwd: root,
    shell: false,
    stdio: 'ignore',
  });
  rmSync(dir, { recursive: true, force: true });
}
