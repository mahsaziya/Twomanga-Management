export function parseChapterNumbers(value) {
  const raw=String(value??'').replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/٫/g,'.').trim();
  const parts=raw.replace(/\/+\s*$/,'').split('/'), result=new Set();
  if(!raw||parts.some(p=>!p.trim()))throw new Error('شماره چپتر را مثل 1، 1-10 یا 1/2/8/21/ وارد کنید.');
  for(const part of parts){
    const token=part.trim(),range=token.match(/^(\d+)\s*-\s*(\d+)$/);
    if(range){const start=Number(range[1]),end=Number(range[2]);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start>=500)throw new Error('بازه نامعتبر است؛ حداکثر ۵۰۰ چپتر انتخاب کنید.');for(let n=start;n<=end;n++)result.add(String(n));}
    else if(/^\d+(?:\.\d+)?$/.test(token)&&Number.isFinite(Number(token))&&Number(token)<=Number.MAX_SAFE_INTEGER)result.add(String(Number(token)));
    else throw new Error('شماره چپتر معتبر نیست؛ از 1، 1-10 یا 1/2/8/21/ استفاده کنید.');
    if(result.size>500)throw new Error('حداکثر ۵۰۰ چپتر انتخاب کنید.');
  }
  return [...result];
}
