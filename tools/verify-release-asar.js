'use strict';

const path = require('path');
const asar = require('@electron/asar');

const asarPath = path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar');
const archiveEntries = asar.listPackage(asarPath).map((archiveFile) => ({
  archiveFile: archiveFile.replace(/^[/\\]/, ''),
  file: archiveFile.replace(/^[/\\]/, '').replace(/\\/g, '/'),
}));
const files = archiveEntries.map((entry) => entry.file);
const archivePathByFile = new Map(archiveEntries.map((entry) => [entry.file, entry.archiveFile]));
const required = [
  'main.js',
  'package.json',
  'core/agent-launch-policy.js',
  'core/navigation-policy.js',
  'core/provider-readiness.js',
  'core/claude-hook-settings.js',
];

for (const file of required) {
  if (!files.includes(file)) throw new Error(`missing required packaged file: ${file}`);
}
for (const file of files) {
  if (/^(?:tests|tools)\//.test(file)
    || file === 'scripts/check-syntax.js'
    || file.includes('__pycache__')) {
    throw new Error(`development artifact was packaged: ${file}`);
  }
}

const readText = (file) => asar.extractFile(asarPath, archivePathByFile.get(file) || file).toString('utf8');
const pkg = JSON.parse(readText('package.json'));
if (pkg.version !== '1.0.1') throw new Error(`unexpected package version: ${pkg.version}`);

const main = readText('main.js');
if (!main.includes("CLAUDE_HUB_ENABLE_CDP === '1'")) throw new Error('CDP opt-in guard missing');
if (!main.includes('webPreferences.javascript = false')) throw new Error('local HTML JavaScript guard missing');
const navigation = readText('core/navigation-policy.js');
if (!navigation.includes("parsed.pathname.startsWith('//')")) throw new Error('UNC file URL guard missing');

const textFiles = files.filter((file) => /\.(?:js|json|html|md|txt|py|ps1)$/i.test(file)
  && !file.startsWith('node_modules/'));
const forbidden = /lintian050|gpt-5\.6-sol|claude-opus-4-8|deepseek-v4-pro\[1m\]/i;
for (const file of textFiles) {
  if (forbidden.test(readText(file))) throw new Error(`private string found in packaged file: ${file}`);
}

console.log(JSON.stringify({
  asarPath,
  totalFiles: files.length,
  version: pkg.version,
  requiredFiles: required,
  textFilesScanned: textFiles.length,
  privacyScan: 'clean',
  developmentArtifacts: 'absent',
}));
