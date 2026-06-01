#!/usr/bin/env node
/**
 * Reload the Job Copilot extension + refresh Oracle page.
 * Thin wrapper around `cdc` CLI.
 *
 * Usage:
 *   node scripts/reload_extension.mjs              # reload ext + refresh Oracle page
 *   node scripts/reload_extension.mjs --ext-only    # reload ext only
 */
import { execSync } from 'child_process';

const extOnly = process.argv.includes('--ext-only');

if (extOnly) {
  execSync('cdc reload-ext "Job Copilot"', { stdio: 'inherit' });
} else {
  execSync('cdc reload-ext+page "Job Copilot" oraclecloud', { stdio: 'inherit' });
}
