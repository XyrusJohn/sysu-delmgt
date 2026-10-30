const fs = require('fs');
const src = fs.readFileSync('src/pages/dashboard.js', 'utf8');
const lines = src.split('\n');

// Simple check: count quotes per line ignoring comments
for (let l = 0; l < lines.length; l++) {
  const line = lines[l];
  // Skip pure comment lines
  if (/^\s*\/\//.test(line)) continue;
  if (/^\s*\*/.test(line)) continue;

  let sq = 0, dq = 0, bt = 0;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    const prev = j > 0 ? line[j-1] : '';
    if (ch === "'" && prev !== '\\') sq++;
    if (ch === '"' && prev !== '\\') dq++;
    if (ch === '`' && prev !== '\\') bt++;
  }
  if (sq % 2 !== 0 || dq % 2 !== 0 || bt % 2 !== 0) {
    console.log(`L${l+1} sq:${sq} dq:${dq} bt:${bt} |${line.substring(0, 180)}`);
  }
}