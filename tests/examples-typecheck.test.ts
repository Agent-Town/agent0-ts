import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('examples', () => {
  it('typechecks against the current SDK surface', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

    execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.examples.json'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }, 120000);
});
