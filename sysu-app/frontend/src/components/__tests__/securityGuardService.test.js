import { SecurityGuardService } from '../../api/securityGuardService.js';

const docs = [
  { id: 'sg-001', guardId: 'SG-001', firstName: 'James', lastName: 'Reyes', middleInitial: 'B.', fullName: 'James B. Reyes', active: true },
  { id: 'sg-002', guardId: 'SG-002', firstName: 'Maria', lastName: 'Santos', middleInitial: '', fullName: 'Maria Santos', active: false },
  { id: 'sg-003', guardId: 'SG-003', firstName: 'Ana', lastName: 'Cruz', middleInitial: 'L', fullName: 'Ana L. Cruz', active: true },
  { id: 'sg-004', guardId: 'SG-004', firstName: 'Pedro', lastName: 'Reyes', middleInitial: '', fullName: 'Pedro Reyes', active: true },
];

describe('SecurityGuardService.search', () => {
  test('empty query returns docs unchanged', () => {
    expect(SecurityGuardService.search('', docs)).toEqual(docs);
  });

  test('whitespace-only query returns docs unchanged', () => {
    expect(SecurityGuardService.search('   ', docs)).toEqual(docs);
  });

  test('case-insensitive substring match on firstName', () => {
    const result = SecurityGuardService.search('james', docs);
    expect(result).toHaveLength(1);
    expect(result[0].guardId).toBe('SG-001');
  });

  test('substring match on lastName returns multiple matches', () => {
    const result = SecurityGuardService.search('re', docs);
    //  Matches both Reyes entries
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.guardId).sort()).toEqual(['SG-001', 'SG-004']);
  });

  test('match on guardId field', () => {
    const result = SecurityGuardService.search('SG-003', docs);
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe('Ana');
  });

  test('no match returns empty array', () => {
    const result = SecurityGuardService.search('zzz', docs);
    expect(result).toEqual([]);
  });
});
