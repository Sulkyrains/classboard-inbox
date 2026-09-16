import {marked} from 'marked';
import DOMPurify from 'dompurify';
marked.setOptions({breaks:true,async:false});
(DOMPurify.addHook as (name: string, hook: (node: Element) => void) => void)('afterSanitizeAttributes', node => {
  if(node.tagName==='A'){node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');}
});
export function renderMarkdown(source:string):string{
  return DOMPurify.sanitize(marked.parse(source) as string);
}
