#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main().then(
  (code) => process.exit(code ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
