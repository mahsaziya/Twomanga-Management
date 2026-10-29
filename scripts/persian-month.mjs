export function persianMonth(reference=new Date()) {
 const format=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric',month:'numeric',day:'numeric'});
 const parts=Object.fromEntries(format.formatToParts(reference).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const local=new Date(reference.getTime()+210*60000);
 const startLocal=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-parts.day+1);
 const days=parts.month<=6?31:parts.month<=11?30:null;
 let length=days;
 if(!length){length=29;const next=Object.fromEntries(format.formatToParts(new Date(startLocal+29*86400000)).map(p=>[p.type,p.value]));if(Number(next.month)===12)length=30;}
 return {start:new Date(startLocal-210*60000).toISOString(),end:new Date(startLocal+length*86400000-210*60000).toISOString(),label:new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',year:'numeric',month:'long'}).format(reference)};
}
