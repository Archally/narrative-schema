#!/usr/bin/env node
// @ts-check
// Standalone CLI entry point for Narrative v1 conformance validation.
// Depends only on Node built-ins, `ajv`, and `yaml`.

import process from 'node:process';
import { runStandaloneCli } from './index.mjs';

process.exitCode = runStandaloneCli(process.argv);
