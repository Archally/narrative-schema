#!/usr/bin/env node
// @ts-check
// Read-only CLI entry point for suggesting the next available Narrative entity ID.

import process from 'node:process';
import { runNextIdCli } from './index.mjs';

process.exitCode = runNextIdCli(process.argv);
