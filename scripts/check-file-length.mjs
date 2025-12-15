#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const args = process.argv.slice(2);
let limit = 400;
let github = false;
let shouldFail = true;
let useAll = false;
let baselinePath = null;
const files = [];

for (const arg of args) {
  if (arg.startsWith('--limit=')) {
    limit = Number.parseInt(arg.split('=')[1], 10);
    if (Number.isNaN(limit) || limit <= 0) {
      console.error('Invalid --limit value.');
      process.exit(2);
    }
    continue;
  }
  if (arg === '--github') {
    github = true;
    continue;
  }
  if (arg === '--no-fail') {
    shouldFail = false;
    continue;
  }
  if (arg === '--all') {
    useAll = true;
    continue;
  }
  if (arg.startsWith('--baseline=')) {
    baselinePath = arg.split('=')[1];
    continue;
  }
  files.push(arg);
}

const textExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.svelte',
  '.css',
  '.scss',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.html',
  '.txt',
]);

const skipDirs = ['node_modules/', '.git/', 'dist/', 'coverage/'];

function collectAllFiles() {
  const tracked = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return tracked.filter((file) => {
    if (skipDirs.some((dir) => file.startsWith(dir))) {
      return false;
    }
    try {
      const stats = statSync(file);
      return stats.isFile();
    } catch {
      return false;
    }
  });
}

function isTextFile(file) {
  const ext = extname(file);
  if (textExtensions.has(ext)) {
    return true;
  }
  // fallback: treat files without extension as text
  return ext === '';
}

const targetFiles = useAll ? collectAllFiles() : files;

if (!targetFiles.length) {
  console.error('No files provided to check-file-length.');
  process.exit(2);
}

let baseline = {};
if (baselinePath) {
  try {
    const baselineContent = readFileSync(baselinePath, 'utf8');
    baseline = JSON.parse(baselineContent);
  } catch (error) {
    console.error(`Failed to read baseline file at ${baselinePath}: ${error.message}`);
    process.exit(2);
  }
}

const offenders = [];

for (const file of targetFiles) {
  if (!isTextFile(file)) {
    continue;
  }
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    if (!useAll) {
      console.warn(`Skipping unreadable file: ${file}`);
    }
    continue;
  }
  const lineCount = content.split('\n').length;
  const allowedLimit = baseline[file] ?? limit;
  if (lineCount > allowedLimit) {
    offenders.push({ file, lineCount, allowedLimit });
    const message = `${file} has ${lineCount} lines (limit ${allowedLimit})`;
    if (github) {
      const command = shouldFail ? 'error' : 'warning';
      console.log(`::${command} file=${file}::${message}`);
    } else {
      console.log(message);
    }
  }
}

if (!offenders.length) {
  console.log(`All checked files meet the ${limit}-line limit.`);
  process.exit(0);
}

if (shouldFail) {
  process.exit(1);
}

process.exit(0);
