import {expect,test} from 'vitest';
import {version,utils,write,read} from 'xlsx';
test('R46: SheetJS meets the fixes for prototype pollution and ReDoS advisories',()=>{
  const [major,minor,patch]=version.split('.').map(Number);
  expect(major>0 || minor>20 || (minor===20 && patch>=2)).toBe(true);
});
test('R46 regression: shipment workbook roundtrip preserves OBD identifiers and quantities',()=>{
  const rows=[{obdNumber:'000001',quantity:10.5,customerName:'Synthetic'},{obdNumber:'000002',quantity:0,customerName:'Unicode Ñ'}];
  const book=utils.book_new();utils.book_append_sheet(book,utils.json_to_sheet(rows),'Shipments');
  const result=read(write(book,{bookType:'xlsx',type:'array'}),{type:'array'});
  expect(utils.sheet_to_json(result.Sheets.Shipments)).toEqual(rows);
});
