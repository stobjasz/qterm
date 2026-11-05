// Opt-in real Linux workflow reads, separate from Vitest and desktop acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {test} from 'node:test';
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const repository=read('../src-tauri/src/wsl_repository.py'),workflows=read('../src-tauri/src/wsl_workflows.py');
test('real Linux workflow definitions retain bytes, source and folder identities without executing project code',{skip:!distro},()=>{
  const result=spawnSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:repository+'\n'+workflows+'\n'+read('wsl-workflows-tests.py'),encoding:'utf8',windowsHide:true,timeout:60000});
  console.log(result.stderr);assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 9 tests/);
});
test('the bundled bridge returns workflow facts and rejects changed reviewed directories',{skip:!distro},()=>{
  const source=repository+'\n'+workflows+'\n'+read('../src-tauri/src/wsl_bridge.py'),bootstrap=read('../src-tauri/src/wsl_bootstrap.py');
  const python=code=>execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:code,encoding:'utf8',windowsHide:true,timeout:30000}).trim();
  const root=python("import tempfile;print(tempfile.mkdtemp(prefix='qterm-wsl-workflows-bridge-'))");
  const call=request=>JSON.parse(execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-c',bootstrap],{input:JSON.stringify({source,request}),encoding:'utf8',windowsHide:true,timeout:30000}));
  try{
    python(`import os;root=${JSON.stringify(root)};os.mkdir(root+'/Case');open(root+'/.qterm.toml','w',encoding='utf8').write('name = "literal 🦀"\\n')`);
    const facts=call({method:'workflow_source',cwd:`${root}/Case`}).result;assert.equal(facts.project,root);assert.match(facts.text,/literal 🦀/);
    const directories=call({method:'workflow_directories',source:facts,paths:['Case']}).result;
    assert.equal(call({method:'workflow_validate',source:facts,directories}).result.valid,true);
    python(`import os;root=${JSON.stringify(root)};os.rename(root+'/Case',root+'/old');os.mkdir(root+'/Case')`);
    assert.match(call({method:'workflow_validate',source:facts,directories}).error,/step folder changed/);
  }finally{python(`import os,shutil;root=os.path.realpath(${JSON.stringify(root)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-workflows-bridge-');shutil.rmtree(root)`);}
});
