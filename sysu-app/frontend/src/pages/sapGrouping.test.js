import {readFileSync} from 'node:fs';
import {test,expect} from 'vitest';
function group(rows) {
  const source=readFileSync('src/pages/dashboard.js','utf8');
  const body=source.match(/groupByDispatch\(shipments\) \{([\s\S]*?)\n {2}\}/)[1];
  return new Function('shipments',body)(rows);
}
test('SAP groups same dispatch with distinct OBDs and keeps repeated item rows',()=>{
  const rows=[{SAPDispatchNumber:'000123',OBDNumber:'000001',OBDItem:'1'},
    {SAPDispatchNumber:'000123',OBDNumber:'000002',OBDItem:'1'},
    {SAPDispatchNumber:'000123',OBDNumber:'000001',OBDItem:'2'}];
  expect(group(rows)['000123']).toEqual(rows);
});
test('SAP planning records cannot form assignable dispatches through a TrId fallback',()=>{
  expect(Object.keys(group([{SAPDispatchNumber:'',TrId:'planning-id'},{SAPDispatchNumber:'   ',TrId:'other'}]))).toEqual([]);
});
test('SAP grouping treats object property names as plain dispatch data',()=>{
  const row={SAPDispatchNumber:'__proto__',OBDNumber:'000001'};
  const grouped=group([row]);
  expect(Object.getPrototypeOf(grouped)).toBeNull();
  expect(grouped['__proto__']).toEqual([row]);
});
