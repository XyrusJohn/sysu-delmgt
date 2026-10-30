// Explicit artifact gate; failing libraries remain visible until an approved SDK update.
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const apkPath = path.resolve(process.argv[2] || 'app/build/outputs/apk/liveTest/app-liveTest.apk');
const apk = fs.readFileSync(apkPath);
let end = apk.length - 22;
while (end >= Math.max(0, apk.length - 65557) && apk.readUInt32LE(end) !== 0x06054b50) end--;
if (end < 0 || apk.readUInt32LE(end) !== 0x06054b50) throw Error('Invalid APK directory');
let entry = apk.readUInt32LE(end + 16);
const results = [];
for (let index = 0; index < apk.readUInt16LE(end + 10); index++) {
  if (apk.readUInt32LE(entry) !== 0x02014b50) throw Error('Invalid APK entry');
  const nameLength = apk.readUInt16LE(entry + 28);
  const name = apk.toString('utf8', entry + 46, entry + 46 + nameLength);
  if (/^(lib|jni)\/(arm64-v8a|x86_64)\/[^/]+\.so$/.test(name)) {
    const local = apk.readUInt32LE(entry + 42);
    const start = local + 30 + apk.readUInt16LE(local + 26) + apk.readUInt16LE(local + 28);
    const data = apk.subarray(start, start + apk.readUInt32LE(entry + 20));
    const method = apk.readUInt16LE(entry + 10);
    const elf = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    if (!elf || elf.toString('hex', 0, 4) !== '7f454c46' || elf[4] !== 2 || elf[5] !== 1) throw Error('Unsupported native artifact');
    const header = Number(elf.readBigUInt64LE(32));
    const size = elf.readUInt16LE(54);
    const count = elf.readUInt16LE(56);
    const loadAlignments = [];
    let relroAligned = true;
    for (let program = 0; program < count; program++) {
      const offset = header + program * size;
      const type = elf.readUInt32LE(offset);
      if (type === 1) loadAlignments.push(Number(elf.readBigUInt64LE(offset + 48)));
      if (type === 0x6474e552) {
        relroAligned = (elf.readBigUInt64LE(offset + 16) + elf.readBigUInt64LE(offset + 40)) % 16384n === 0n;
      }
    }
    results.push({library: name, loadAlignments, relroAligned,
      aligned: loadAlignments.length > 0 && loadAlignments.every(alignment => alignment >= 16384) && relroAligned});
  }
  entry += 46 + nameLength + apk.readUInt16LE(entry + 30) + apk.readUInt16LE(entry + 32);
}
if (!results.length) throw Error('No 64-bit native libraries checked');
console.log(JSON.stringify({artifact: path.basename(apkPath), checked: results.length,
  passed: results.filter(result => result.aligned).length, failed: results.filter(result => !result.aligned).length, results}, null, 2));
process.exitCode = results.some(result => !result.aligned) ? 1 : 0;
