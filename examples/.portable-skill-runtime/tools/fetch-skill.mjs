#!/usr/bin/env node
import fs from 'node:fs/promises';

const gateways = ["https://gateway.pinata.cloud/ipfs/","https://ipfs.io/ipfs/","https://dweb.link/ipfs/"];

async function fetchText(uri) {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    if (!cid) throw new Error('Invalid IPFS URI');
    const errors = [];
    for (const gateway of gateways) {
      const url = `${gateway}${cid}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (res.ok) return await res.text();
        errors.push(`${url} -> HTTP ${res.status}`);
      } catch (error) {
        errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Failed to fetch ${uri} from all gateways: ${errors.join(' | ')}`);
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetch(uri, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  throw new Error(`Unsupported URI scheme: ${uri}`);
}

async function main() {
  const [uri, outPath] = process.argv.slice(2);
  if (!uri || !outPath) {
    throw new Error('Usage: fetch-skill.mjs <uri> <output_path>');
  }
  const content = await fetchText(uri);
  await fs.writeFile(outPath, content, 'utf8');
  console.log(outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
