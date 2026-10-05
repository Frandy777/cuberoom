import { describe, expect, it } from 'vitest';
import { parseRoom } from '../src/components/Qr';

describe('parseRoom', () => {
  it('reads the code from a room link', () => {
    expect(parseRoom('https://cuberoom.app/?room=abc234')).toBe('ABC234');
    expect(parseRoom('http://192.168.1.5:5173/?room=XYZ789')).toBe('XYZ789');
  });
  it('accepts a bare code', () => {
    expect(parseRoom(' k7m2pq ')).toBe('K7M2PQ');
  });
  it('rejects anything else', () => {
    expect(parseRoom('https://example.com/')).toBeUndefined();
    expect(parseRoom('https://cuberoom.app/?room=ABC1O0')).toBeUndefined();
    expect(parseRoom('hello world')).toBeUndefined();
  });
});
