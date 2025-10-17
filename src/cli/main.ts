#!/usr/bin/env node
/** The entry point. Everything it does is in run(); this only sets the code. */

import { run } from './program';
import { consoleIo } from './output';

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2), { io: consoleIo() });
  process.exitCode = code;
}

void main();
