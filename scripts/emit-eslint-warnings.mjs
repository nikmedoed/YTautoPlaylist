#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [reportPath] = process.argv.slice(2);

if (!reportPath) {
  console.error('Usage: node scripts/emit-eslint-warnings.mjs <eslint-report.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Failed to read ESLint report: ${error.message}`);
  process.exit(2);
}

let warningCount = 0;
let errorCount = 0;

for (const fileResult of report) {
  const { filePath, messages = [] } = fileResult;
  for (const message of messages) {
    const {
      severity,
      line = 1,
      column = 1,
      message: text,
      ruleId,
    } = message;
    const base = `file=${filePath},line=${line},col=${column}`;
    const details = ruleId ? `${text} [${ruleId}]` : text;
    if (severity === 2) {
      errorCount += 1;
      console.log(`::error ${base}::${details}`);
    } else if (severity === 1) {
      warningCount += 1;
      console.log(`::warning ${base}::${details}`);
    }
  }
}

console.log(`ESLint summary: ${errorCount} error(s), ${warningCount} warning(s).`);

if (errorCount > 0) {
  process.exit(1);
}

process.exit(0);
