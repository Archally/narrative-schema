#!/usr/bin/env node
// @ts-check
// Standalone CLI entry point for Narrative semantic checks powered by @archally/semantic-checker.

import process from 'node:process';
import { runSemanticCli } from './index.mjs';

process.exitCode = await runSemanticCli(process.argv);
