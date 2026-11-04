import {parseActivity} from './core.mjs';

const MAX_TEXT = 150000;
// QQ miniapp payload shape: meta.detail_1.qqdocurl. Read only explicit
// destinations; titles and arbitrary threadId numbers never identify an activity.
function officialActivity(value) {
 if(typeof value!=='string'||value.length>4096)return null;
 try {
  const u=new URL(value);
  if(!/^\/[ef]\/[A-Za-z0-9]{6,32}\/?$/.test(u.pathname))return null;
  return parseActivity(u.href);
 } catch {return null;}
}
const cqUnescape = s=>s.replace(/&#44;/g,',').replace(/&#91;/g,'[').replace(/&#93;/g,']').replace(/&amp;/g,'&');
function jsonCandidates(text) {
 const results=[];
 try{results.push(JSON.parse(text));return results;}catch{}
 for(const match of text.matchAll(/\[CQ:json,data=([^\]]*)\]/g)){
  try{results.push(JSON.parse(cqUnescape(match[1])));}catch{}
 }
 // Accessibility exports may put the card JSON between ordinary message lines.
 // Balanced scanning, not greedy regular expressions or executable evaluation.
 let start=-1,depth=0,string=false,escape=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(start<0){if(ch==='{'){start=i;depth=1;}continue;}
  if(string){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')string=false;continue;}
  if(ch==='"')string=true;else if(ch==='{')depth++;else if(ch==='}'&&!--depth){try{results.push(JSON.parse(text.slice(start,i+1)));}catch{}start=-1;}
 }
 return results;
}
export function extractCardActivities(input) {
 const text=typeof input==='string'?input:'';
 if(text.length>MAX_TEXT)return {activities:[],cards:0,unresolved:0};
 const activities=new Map();let cards=0,unresolved=0;
 const inspect = card=>{
  if(!card||typeof card!=='object'||!/^com\.tencent\.miniapp(?:_\d+)?$/.test(card.app||''))return;
  const detail=card.meta?.detail_1;
  const activity=officialActivity(detail?.qqdocurl)||officialActivity(detail?.url);
  if(!activity&&!/接龙管家/.test([detail?.title,card.desc,card.prompt].filter(v=>typeof v==='string').join(' ')))return;
  cards++;
  if(activity)activities.set(activity.id,activity);else unresolved++;
 };
 for(const candidate of jsonCandidates(text)){
  inspect(candidate);
  // Optional OneBot JSON segment envelope. This parser does not install or
  // connect any external receiver; the source must independently supply it.
  if(candidate?.type==='json'){
   try{inspect(typeof candidate.data?.data==='string'?JSON.parse(candidate.data.data):candidate.data?.data);}catch{}
  }
 }
 return {activities:[...activities.values()],cards,unresolved};
}
