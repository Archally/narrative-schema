#!/usr/bin/env node
// @ts-check
// Standalone CLI entry point for building a deterministic Narrative authored-graph model.json.

import process from 'node:process';
import { runBuilderCli } from './index.mjs';

process.exitCode = runBuilderCli(process.argv);
