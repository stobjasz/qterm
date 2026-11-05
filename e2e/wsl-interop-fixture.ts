import fs from "node:fs";
import path from "node:path";
import {execFileSync,spawn} from "node:child_process";
import {wslLaunchFixture} from "./wsl-launch-fixture";

/** Inspect/clean only this unique fixture's exact Windows executable/script/tags. */
export function wslInteropFixture(){
  const linux=wslLaunchFixture(),parent=fs.realpathSync.native(path.resolve(".tools.local"));
  const root=path.join(parent,`wsl-interop-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
  const script=path.join(root,"interop.mjs"),control=path.join(root,"control.ps1"),node=fs.realpathSync.native(process.execPath);
  let linuxNode="";
  const ps=(value:string)=>`'${value.replaceAll("'","''")}'`;
  function seed(){
    if(!linux.distro)return;
    linux.seed();fs.mkdirSync(root);
    fs.writeFileSync(script,`import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const tag=process.argv[2];if(!/^(owned|other|unrelated)(-child)?$/.test(tag))throw new Error('Invalid fixture tag');
if(!tag.endsWith('-child'))spawn(process.execPath,[fileURLToPath(import.meta.url),tag+'-child'],{detached:true,stdio:'ignore',windowsHide:true}).unref();
net.createServer().listen(0,'127.0.0.1',()=>console.log('INTEROP_PROGRAM_'+(6*7)));
`,"utf8");
    fs.writeFileSync(control,`param([switch]$Cleanup)
$ErrorActionPreference='Stop'
$expectedExe=${ps(node)}
$scriptPath=${ps(script)}
$pattern='(?:^|\\s)"?'+[regex]::Escape($scriptPath)+'"?\\s+"?(?<tag>owned|owned-child|other|other-child|unrelated|unrelated-child)"?\\s*$'
$observed=@()
foreach($candidate in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")){
  if($candidate.CommandLine -notmatch $pattern){continue}
  $p=$null
  try{
    try{$p=[Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)}catch [ArgumentException]{continue}
    $null=$p.Handle
    # Pin the OS object before re-reading its command line. Never signal a reused PID.
    $fresh=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$candidate.ProcessId)
    if($p.HasExited -or !$fresh -or $fresh.CommandLine -notmatch $pattern){continue}
    $tag=$Matches['tag']
    if($p.MainModule.FileName -ine $expectedExe){throw 'Fixture executable identity changed'}
    if($Cleanup){$p.Kill();if(!$p.WaitForExit(5000)){throw 'Fixture program did not exit'}}else{$observed+=@{tag=$tag;pid=$p.Id;born=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}}
  }catch{if(!$p -or !$p.HasExited){throw}}finally{if($p){$p.Dispose()}}
}
ConvertTo-Json -InputObject @($observed) -Compress
`,"utf8");
    linuxNode=linux.python(`import subprocess;print(subprocess.run(['/usr/bin/wslpath','-u',${JSON.stringify(node)}],check=True,capture_output=True,text=True).stdout.strip())`);
  }
  function inspect(cleanup=false):{tag:string;pid:number;born:string}[]{
    if(!fs.existsSync(control))return[];
    return JSON.parse(execFileSync(path.resolve(".tools.local/pwsh/pwsh.exe"),["-NoLogo","-NoProfile","-File",control,...(cleanup?["-Cleanup"]:[])],{encoding:"utf8",timeout:30000,windowsHide:true}).trim());
  }
  function unrelated(){return spawn(node,[script,"unrelated"],{stdio:"ignore",windowsHide:true});}
  function cleanup(){
    inspect(true);linux.cleanup();
    if(!fs.existsSync(root))return;
    const actual=fs.realpathSync.native(root);
    if(path.dirname(actual).toLowerCase()!==parent.toLowerCase()||!path.basename(actual).startsWith("wsl-interop-"))throw new Error("Refusing unexpected interoperability fixture cleanup");
    fs.rmSync(actual,{recursive:true});
  }
  const command=(tag:"owned"|"other"="owned")=>`'${linuxNode.replaceAll("'","'\\''")}' '${script.replaceAll("'","'\\''")}' ${tag}`;
  return{...linux,seed,cleanup,inspect,unrelated,command,windowsRoot:root};
}
