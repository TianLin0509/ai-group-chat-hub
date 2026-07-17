'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

const files = execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean);

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${file}\n${result.stderr || result.stdout || 'syntax check failed'}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Syntax check passed: ${files.length} JavaScript files`);
