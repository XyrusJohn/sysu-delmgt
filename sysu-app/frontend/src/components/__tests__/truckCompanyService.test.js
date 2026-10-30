import { TruckCompanyService } from '../../api/truckCompanyService.js';

const docs = [
  { id: 'tc-001', companyCode: 'TC-001', forwarderCode: 'FW-A', name: 'Northbound Logistics', active: true },
  { id: 'tc-002', companyCode: 'TC-002', forwarderCode: 'FW-B', name: 'Eastway Movers', active: false },
  { id: 'tc-003', companyCode: 'TC-003', forwarderCode: 'FW-C', name: 'Southline Carriers', active: true },
  { id: 'tc-004', companyCode: 'TC-004', forwarderCode: 'FW-A', name: 'Northstar Freight', active: true },
];

describe('TruckCompanyService.search', () => {
  test('empty query returns docs unchanged', () => {
    expect(TruckCompanyService.search('', docs)).toEqual(docs);
  });

  test('whitespace-only query returns docs unchanged', () => {
    expect(TruckCompanyService.search('   ', docs)).toEqual(docs);
  });

  test('case-insensitive substring match on name', () => {
    const result = TruckCompanyService.search('northstar', docs);
    expect(result).toHaveLength(1);
    expect(result[0].companyCode).toBe('TC-004');
  });

  test('substring match on forwarderCode returns multiple matches', () => {
    const result = TruckCompanyService.search('FW-A', docs);
    //  Matches both FW-A entries
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.companyCode).sort()).toEqual(['TC-001', 'TC-004']);
  });

  test('no match returns empty array', () => {
    const result = TruckCompanyService.search('zzz', docs);
    expect(result).toEqual([]);
  });
});
