import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const installRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runKey='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const valueName='JielongAssistant';
export function startupSettings({root=installRoot,platform=process.platform,execute=promisify(execFile),systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 const reg=path.join(systemRoot,'System32','reg.exe');
 const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command=`"${path.join(systemRoot,'System32','wscript.exe')}" //B //Nologo "${path.join(root,'start-background.vbs')}"`;
 const invoke=args=>execute(reg,args,{windowsHide:true,shell:false,timeout:10000});
 let cached='',cacheUntil=0;
 async function supported(){
  if(platform!=='win32')return false;
  try{return JSON.parse(await fs.readFile(path.join(root,'installation.json'),'utf8')).application==='JielongAssistant';}catch{return false;}
 }
 async function current(force=false){
  if(!force&&Date.now()<cacheUntil)return cached;
  // reg.exe prints the active legacy console code page. Read with an explicit
  // UTF-8 writer instead, so Chinese installation paths round-trip unchanged.
  const script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run');if($null -ne $k){try{[Console]::Write([string]$k.GetValue('JielongAssistant',''))}finally{$k.Dispose()}}";
  const {stdout}=await execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,timeout:10000,encoding:'utf8'});
  cached=stdout.trim();cacheUntil=Date.now()+10000;return cached;
 }
 return {
  async state(){if(!await supported())return {supported:false,enabled:false};const entry=await current();return {supported:true,enabled:entry===command,otherInstallation:!!entry&&entry!==command};},
  async set(enabled){
   if(typeof enabled!=='boolean')throw Error('开机自启选项无效');
   if(!await supported())throw Error('开机自启仅在 Windows 安装版中可用');
   const entry=await current(true);
   if(entry&&entry!==command)throw Error('另一份接龙助手已设置开机自启，请先在那份应用中关闭');
   if(enabled)await invoke(['add',runKey,'/v',valueName,'/t','REG_SZ','/d',command,'/f']);
   else if(entry)await invoke(['delete',runKey,'/v',valueName,'/f']);
   cacheUntil=0;const result=await this.state();if(result.enabled!==enabled)throw Error('开机自启设置未生效');return result;
  }
 };
}
