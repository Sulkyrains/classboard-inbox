import {describe,it,expect} from 'vitest';
import {TEMP_PASSWORD_ALPHABET,TEMP_PASSWORD_LENGTH,randomTempPassword} from '../src/shared/accounts';

describe('randomTempPassword',()=>{
  it('默认 10 位，且只使用约定的字符集',()=>{
    for(let i=0;i<200;i++){
      const secret=randomTempPassword();
      expect(secret).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect([...secret].every(c=>TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true);
    }
  });
  it('不含 0 O 1 l I 这些容易被读错抄错的字符',()=>{
    const pool=Array.from({length:2000},()=>randomTempPassword()).join('');
    expect(pool.length).toBe(2000*TEMP_PASSWORD_LENGTH);
    for(const hard of '0O1lI')expect(pool.includes(hard)).toBe(false);
  });
  it('字符集没有重复字符（否则某些字符会更容易出现）',()=>{
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(TEMP_PASSWORD_ALPHABET.length);
    expect(256%TEMP_PASSWORD_ALPHABET.length).toBeGreaterThan(0);   // 取模会有偏向，生成器用拒绝采样绕开
  });
  it('每次生成都不一样',()=>{
    const drawn=new Set(Array.from({length:300},()=>randomTempPassword()));
    expect(drawn.size).toBe(300);
  });
  it('长度可以按需指定',()=>{
    expect(randomTempPassword(16)).toHaveLength(16);
  });
});
