'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.join(__dirname, '..', 'public', 'index-redesign.html');
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim().length > 1000);
if (scripts.length !== 1) {
  console.error(`Expected one application inline script; found ${scripts.length}.`);
  process.exit(1);
}
try {
  new vm.Script(scripts[0][2], { filename: file });
  console.log('Enterprise inline JavaScript syntax passed.');
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
