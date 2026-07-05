#!/usr/bin/env node

const { runCli } = require('./index');

try {
  const status = runCli(process.argv.slice(2));
  process.exit(status);
} catch (error) {
  console.error(`[prisma-tools] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
