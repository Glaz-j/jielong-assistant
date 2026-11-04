import { normalizeLabel } from './core.mjs';
export const PROFILE_FIELDS = ['姓名','单位','职工号','所属部门'];
export const TEST_PROFILE = Object.freeze({'姓名':'测试同学','单位':'测试单位','职工号':'TEST0001','所属部门':'测试部门'});
const aliases = {'姓名':['姓名','真实姓名'], '单位':['单位','所在单位','工作单位'], '职工号':['职工号','工号','员工号'], '所属部门':['所属部门','所在部门','部门']};
export function fixedProfile(input) {
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!PROFILE_FIELDS.includes(k)))throw Error('只允许姓名、单位、职工号、所属部门四个固定字段。');
 return Object.fromEntries(PROFILE_FIELDS.map(k=>{
  const v=input[k]??'';
  if(typeof v!=='string'||v.length>120||/[\r\n\x00-\x1f]/.test(v))throw Error(k+'格式不正确，请填写单行文本，最多 120 字。');
  return [k,v.trim()];
 }));
}
export function fixedPlan(fields,input) {
 const profile=fixedProfile(input), values={}, errors=[], seen=new Set();
 for(const f of fields){
  if(f.manual)continue;
  const label=normalizeLabel(f.label), key=PROFILE_FIELDS.find(k=>aliases[k].includes(label));
  if(!key){if(f.required)errors.push('出现固定范围之外的必填项：'+f.label);continue;}
  if(seen.has(key)){errors.push('表单重复出现字段：'+key);continue;}seen.add(key);
  if(!f.supported || !['text','textarea','tel','number','select','radio'].includes(f.type)){errors.push(key+'的控件类型尚不支持');continue;}
  const value=profile[key];if(!value){errors.push('尚未设置'+key);continue;}
  let mapped=value;
  if(f.options?.length){const opts=f.options.filter(o=>!o.disabled&&(o.label===value||o.value===value));if(opts.length!==1){errors.push(key+'没有唯一匹配的选项');continue;}mapped=opts[0].value;}
  if(f.disabled){if(f.value!==mapped)errors.push(key+'不可修改且与固定资料不一致');continue;}
  values[f.id]=mapped;
 }
 if(!seen.size)errors.push('没有识别到四个固定字段中的任何一项');
 return {values,errors,matchedCount:seen.size,consentPending:fields.some(f=>f.manual&&f.required&&!f.value)};
}
