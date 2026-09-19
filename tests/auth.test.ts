import {describe,it,expect} from 'vitest';
import {ITERATIONS,derive,digestIterations,hashPassword,verifyPassword} from '../server/auth';

describe('password digests',()=>{
  it('verifies legacy bare-hex digests created with the old parameters',async()=>{
    const salt='8ac4618d-cc4e-4f20-ba3d-dde8dc3d43af';
    const legacy=await derive('correct horse battery staple',salt,ITERATIONS);
    expect(legacy).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyPassword('correct horse battery staple',salt,legacy)).toBe(true);
    expect(await verifyPassword('wrong password',salt,legacy)).toBe(false);
  });
  it('writes and verifies the parameter-carrying format',async()=>{
    const salt='g2Xf1w';
    const stored=await hashPassword('another-long-secret-42',salt);
    expect(stored.startsWith(`pbkdf2$sha256$${ITERATIONS}$`)).toBe(true);
    expect(digestIterations(stored)).toBe(ITERATIONS);
    expect(await verifyPassword('another-long-secret-42',salt,stored)).toBe(true);
    expect(await verifyPassword('another-long-secret-43',salt,stored)).toBe(false);
  });
  it('falls back to the default parameters for unreadable digests',()=>{
    expect(digestIterations('deadbeef')).toBe(ITERATIONS);
    expect(digestIterations('pbkdf2$sha256$999999999999$'+'0'.repeat(64))).toBe(ITERATIONS);
    expect(digestIterations('pbkdf2$sha256$notanumber$'+'0'.repeat(64))).toBe(ITERATIONS);
  });
});
