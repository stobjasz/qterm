// Real Linux facts underpin future grants; no grant or execution is enabled here.
import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {test} from 'node:test';
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
test('Linux task-source reads bind user, repository, directory and manifest identities without executing project tools',{skip:!distro},()=>{
  const source=['wsl_repository.py','wsl_workflows.py','wsl_task_sources.py'].map(name=>read('../src-tauri/src/'+name)).join('\n')+'\n'+read('wsl-task-sources-tests.py');
  const result=spawnSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:source,encoding:'utf8',windowsHide:true,timeout:120000});
  console.log(result.stderr);assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 9 tests/);
});
