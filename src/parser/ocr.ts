/** Normalize layout whitespace introduced by OCR without joining separate messages. */
export function normalizeOcrText(text:string):string {
  return text.replace(/\r\n?/g,'\n').split('\n').map(line=>line
    .replace(/(?<=\p{Script=Han})[\t ]+(?=[\p{Script=Han}\d])|(?<=\d)[\t ]+(?=\p{Script=Han})/gu,'')
    .replace(/([@＠])[\t ]+/g,'$1')
    .replace(/([@＠](?:全体成员|全体同学|所有人|全体|大家))[\t ]*/g,'$1 ')
    .replace(/([@＠][^@＠\s]{1,24}班)(?=[\p{Script=Han}])/gu,'$1 ')
    .replace(/(\d)[\t ]*([/:：])[\t ]*(?=\d)/g,'$1$2')
    .trim()).join('\n').trim();
}
