#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function main() {
  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    throw new Error('Usage: verify-skill.mjs <file_path>');
  }
  const content = await fs.readFile(filePath, 'utf8');
  const hash = '0x' + createHash('sha256').update(content, 'utf8').digest('hex');
  console.log(hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
