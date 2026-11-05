// Actual Linux monitor processes and authenticated sockets; explicit opt-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
test('Linux verification monitors retain context, authenticate requests and end with their owner',{skip:!process.env.QTERM_E2E_WSL_DISTRIBUTION},()=>{
  const read=path=>fs.readFileSync(path,'utf8');
  const source=read('src-tauri/src/wsl_repository.py')+'\n'+read('src-tauri/src/wsl_verification.py')+'\n'+read('scripts/wsl-verification-tests.py');
  const result=spawnSync('wsl.exe',['--distribution',process.env.QTERM_E2E_WSL_DISTRIBUTION,'--exec','/usr/bin/python3','-I','-S','-'],{input:source,encoding:'utf8',windowsHide:true,timeout:120000});
  console.log(result.stderr);assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 8 tests/);
});
