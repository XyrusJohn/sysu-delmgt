//  @vitest-environment node
import {test,expect} from 'vitest';
import makeConfig from '../../vite.config.js';
test('R32 Vite development proxy uses the explicit local API and primary socket',()=>{
  const config=makeConfig({command:'serve',mode:'test'});
  expect(config.server.proxy['/api'].target).toBe('http://127.0.0.1:3000');
  expect(config.server.proxy['/socket.io'].target).toBe('http://127.0.0.1:3000');
});
