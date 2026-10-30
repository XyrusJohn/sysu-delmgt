import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
test('R46: any locked gRPC package excludes the certificate-authentication advisory ranges',()=>{
  const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  const packages=Object.entries(lock.packages).filter(([path])=>path.endsWith('node_modules/@grpc/grpc-js'));
  for(const [,pkg] of packages) {
    const [major,minor,patch]=pkg.version.split('.').map(Number);
    expect(major>1 || (major===1 && (minor>14 || (minor===14 && patch>=5) || (minor===13 && patch>=6)))).toBe(true);
  }
});
