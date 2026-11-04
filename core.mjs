const hosts = new Set(['i.jielong.com', 'i.jielong.co', 'jielong.com', 'www.jielong.com']);
export function parseActivity(input) {
  const raw = String(input || '').trim();
  let id, kind = 'e';
  if (/^[A-Za-z0-9]{6,32}$/.test(raw)) id = raw;
  else if (/^event\/pages\/detail\/index(?:\.html)?\?/.test(raw)) {
    id = new URL(raw, 'https://i.jielong.com/').searchParams.get('threadId');
  } else {
    let u; try { u = new URL(raw); } catch { throw new Error('请粘贴接龙管家活动链接、小程序页面路径或活动编号。'); }
    if (u.protocol !== 'https:' || !hosts.has(u.hostname) || u.port || u.username || u.password) throw new Error('仅支持接龙管家官方 HTTPS 活动链接。');
    const match=u.pathname.match(/^\/(e|f)\/([A-Za-z0-9]+)\/?$/);
    kind=match?.[1]||'e';
    id = match?.[2] || u.searchParams.get('threadId');
  }
  if (!id || !/^[A-Za-z0-9]{6,32}$/.test(id)) throw new Error('未识别到活动编号，请使用带 threadId 的链接或 /e/、/f/ 官方链接。');
  return { id, url: `https://i.jielong.com/${kind}/${id}` };
}
export function normalizeLabel(s) { return String(s || '').replace(/[*＊]/g,'').replace(/^\s*\d+[.、．]\s*/, '').replace(/[\s:：]/g, '').trim(); }
const groups = [ ['姓名','名字','真实姓名','学生姓名'], ['手机号','手机号码','联系电话','联系手机','电话'], ['学号','学生学号'], ['学院','所在学院'], ['专业','所学专业'], ['班级','所在班级'], ['邮箱','电子邮箱','电子邮件'] ];
export function suggest(fields, profile) {
  return fields.map(f => {
    const n = normalizeLabel(f.label);
    let entries = Object.entries(profile).filter(([k]) => normalizeLabel(k) === n);
    if (!entries.length) {
      const group = groups.find(g => g.includes(n));
      if (group) entries = Object.entries(profile).filter(([k]) => group.includes(normalizeLabel(k)));
    }
    let value = entries.length === 1 ? entries[0][1] : f.value;
    if(entries.length===1&&f.options?.length) {
      const texts=f.type==='checkbox'?String(value).split('|').map(x=>x.trim()):[value];
      const mapped=texts.map(t=>f.options.filter(o=>!o.disabled && (o.label===t||o.value===t)));
      if(mapped.every(m=>m.length===1))value=f.type==='checkbox'?mapped.map(m=>m[0].value):mapped[0][0].value;
      else value=f.value;
    }
    return { ...f, suggested: value ?? '', matched: entries.length === 1, ambiguous: entries.length > 1 };
  });
}
export function validate(fields, values) {
  const errors = [];
  for (const f of fields) {
    if(f.manual){if(f.required&&!f.value)errors.push('请先阅读并确认官网授权：'+f.label);continue;}
    const v = values[f.id];
    if (!f.supported) { if(f.required) errors.push(`${f.label} 需要在官网手动填写`); continue; }
    if (f.disabled) continue;
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (f.required && empty) { errors.push(`请填写「${f.label}」`); continue; }
    if (empty) continue;
    if (f.options?.length) {
      const chosen = Array.isArray(v) ? v : [v];
      if(chosen.some(x => !f.options.some(o => o.value === x))) errors.push(`「${f.label}」的选项已变化，请重新读取`);
    } else {
      if(typeof v !== 'string') { errors.push(`「${f.label}」需填写文本`); continue; }
      if((f.type === 'email' || /邮箱/.test(f.label)) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`「${f.label}」邮箱格式不正确`);
      if(/手机|联系电话/.test(f.label) && !/^1[3-9]\d{9}$/.test(v)) errors.push(`「${f.label}」应为 11 位手机号`);
      if(f.maxLength > 0 && v.length > f.maxLength) errors.push(`「${f.label}」超出长度限制`);
    }
  }
  return errors;
}
