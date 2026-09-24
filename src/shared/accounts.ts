/** 账号管理页（仅班长）用到的类型与工具。 */
export interface AccountRow {
  id:string; student_id:string; display_name:string; role:'committee'|'student';
  position:string|null; must_change_password:boolean; created_at:string; last_login_at:string|null;
  has_calendar:boolean; sessions:number; push_subs:number; reads:number;
}
export interface AccountLogEntry {
  id:string; account_label:string; actor_name:string; actor_position:string; action:string; detail:string; created_at:string;
}
/**
 * 临时密码字符集去掉 0/O/1/l/I 等易混字符：班长要口头或手写转达，读错一位就登不上。
 * 与 scripts/accounts.mjs 的初始密码保持一致，同学看到的密码形态是统一的。
 */
export const TEMP_PASSWORD_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
export const TEMP_PASSWORD_LENGTH=10;
/** 拒绝采样：256 不是字符集长度的整数倍，取模会偏向排在前面的字符，所以丢掉超出的部分再换一批。 */
export function randomTempPassword(length=TEMP_PASSWORD_LENGTH){
  const limit=256-(256%TEMP_PASSWORD_ALPHABET.length),chars:string[]=[];
  while(chars.length<length){
    for(const byte of crypto.getRandomValues(new Uint8Array(length*2))){
      if(byte>=limit)continue;
      chars.push(TEMP_PASSWORD_ALPHABET[byte%TEMP_PASSWORD_ALPHABET.length]);
      if(chars.length===length)break;
    }
  }
  return chars.join('');
}
