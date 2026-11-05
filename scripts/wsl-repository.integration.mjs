// Opt-in real Linux boundary tests; run with node --test, never through Vitest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {test} from 'node:test';
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const repository=read('../src-tauri/src/wsl_repository.py'),bridge=read('../src-tauri/src/wsl_bridge.py'),bootstrap=read('../src-tauri/src/wsl_bootstrap.py');
const python=source=>execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:source,encoding:'utf8',windowsHide:true,timeout:30000}).trim();
test('real Linux repository snapshots and continuous coverage survive edits, restores and failures',{skip:!distro},()=>{
  const result=spawnSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:repository+'\n'+read('wsl-repository-tests.py'),encoding:'utf8',windowsHide:true,timeout:120000});
  console.log(result.stderr);
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 9 tests/);
});
test('the bundled stdin transport preserves Unicode and carries helper source beyond Windows argv limits',{skip:!distro},()=>{
  const source=repository+'\n'+bridge+'\n# '+ '🦀'.repeat(12000);
  const root=python("import tempfile;print(tempfile.mkdtemp(prefix='qterm-wsl-transport-'))"),cwd=`${root}/Case it's 🦀`;
  try{
    python(`import os,subprocess;cwd=${JSON.stringify(cwd)};os.mkdir(cwd);subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','init','--quiet',cwd],check=True)`);
    const call=method=>JSON.parse(execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-c',bootstrap],{input:JSON.stringify({source,request:{method,cwd}}),encoding:'utf8',windowsHide:true,timeout:30000}));
    assert.equal(call('folder').result.cwd,cwd);
    const snapshot=call('repository_snapshot');assert.equal(snapshot.result.root,cwd);assert.match(snapshot.result.digest,/^[0-9a-f]{64}$/);assert.equal(snapshot.result.files,0);
  }finally{python(`import os,shutil;root=os.path.realpath(${JSON.stringify(root)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-transport-');shutil.rmtree(root)`);}
});
test('the helper rejects oversized stdin envelopes before executing their source',{skip:!distro},()=>{
  const result=spawnSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-c',bootstrap],{input:JSON.stringify({source:'print("MUST_NOT_EXECUTE")\n#'+'x'.repeat(2_097_152),request:{}}),encoding:'utf8',windowsHide:true,timeout:30000});
  assert.ifError(result.error);assert.notEqual(result.status,0);assert.match(result.stderr,/exceeds 2 MiB/);assert.doesNotMatch(result.stdout,/MUST_NOT_EXECUTE/);
});
