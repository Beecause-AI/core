import { describe, expect, it } from 'vitest';
import { AlreadyExistsError, FieldValue, isFieldSentinel } from '../../src/ports/store.js';

describe('DocStore port sentinels', () => {
  it('serverTimestamp() is a detectable sentinel', () => {
    const fv = FieldValue.serverTimestamp();
    expect(fv).toEqual({ __fv: 'serverTimestamp' });
    expect(isFieldSentinel(fv)).toBe(true);
  });
  it('increment(n) carries its amount and is detectable', () => {
    const fv = FieldValue.increment(5);
    expect(fv).toEqual({ __fv: 'increment', by: 5 });
    expect(isFieldSentinel(fv)).toBe(true);
  });
  it('isFieldSentinel rejects plain data', () => {
    for (const v of [null, undefined, 1, 'x', {}, { a: 1 }, { __fv: undefined }]) {
      expect(isFieldSentinel(v)).toBe(false);
    }
  });
  it('AlreadyExistsError carries the id and a stable name', () => {
    const e = new AlreadyExistsError('doc-1');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AlreadyExistsError');
    expect(e.id).toBe('doc-1');
  });
});
