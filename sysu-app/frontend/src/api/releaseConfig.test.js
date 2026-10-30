import {beforeEach, afterEach, test, expect, vi} from 'vitest';
beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries({VITE_RELEASE_TARGET: 'local', VITE_API_URL: 'http://127.0.0.1:3000',
    VITE_SOCKET_URL: 'http://127.0.0.1:3000', VITE_DRIVER_TRACKING_URL: 'http://127.0.0.1:8091'})) vi.stubEnv(key, value);
});
afterEach(() => {vi.unstubAllEnvs();});
test('explicit workstation testing supports local backend endpoints', async () => {
  const {resolveReleaseConfig}=await import('./releaseConfig.js');
  expect(resolveReleaseConfig({VITE_RELEASE_TARGET:'production',
    DEV:true,VITE_USE_LOCAL_BACKEND:'true',VITE_API_URL:'http://localhost:3000',
    VITE_SOCKET_URL:'http://localhost:3000',VITE_DRIVER_TRACKING_URL:'https://sysu-go.onrender.com'}).BASE_URL)
    .toBe('http://localhost:3000');
});
test('R32 production builds refuse emulator targets while E2E build mode permits them', async () => {
  const {assertProductionBuildTarget}=await import('./releaseConfig.js');
  expect(()=>assertProductionBuildTarget('build','production',{VITE_RELEASE_TARGET:'local'})).toThrow(/build:e2e/);
  expect(()=>assertProductionBuildTarget('build','production',{VITE_RELEASE_TARGET:'production'})).not.toThrow();
  expect(()=>assertProductionBuildTarget('build','e2e',{VITE_RELEASE_TARGET:'local'})).not.toThrow();
});
test('workstation opt-in cannot allow localhost in a release build', async () => {
  const {resolveReleaseConfig}=await import('./releaseConfig.js');
  expect(()=>resolveReleaseConfig({VITE_RELEASE_TARGET:'production',
    DEV:false,VITE_USE_LOCAL_BACKEND:'true',VITE_API_URL:'http://localhost:3000',
    VITE_SOCKET_URL:'http://localhost:3000',VITE_DRIVER_TRACKING_URL:'https://sysu-go.onrender.com'}))
    .toThrow(/HTTPS/);
});
test('R32 missing endpoints fail before any silent production fallback', async () => {
  vi.stubEnv('VITE_API_URL', '');
  await expect(import('./config.js')).rejects.toThrow(/VITE_API_URL/);
});
test('R32 local mode cannot target a live production API', async () => {
  vi.stubEnv('VITE_API_URL', 'https://sysu-app.onrender.com');
  await expect(import('./config.js')).rejects.toThrow(/local|production/i);
});
test('R32 explicit isolated API and both socket endpoints are preserved', async () => {
  const {API_CONFIG} = await import('./config.js');
  expect(API_CONFIG).toEqual({BASE_URL: 'http://127.0.0.1:3000', SOCKET_URL: 'http://127.0.0.1:3000', DRIVER_TRACKING_URL: 'http://127.0.0.1:8091'});
});
