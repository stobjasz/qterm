import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {test} from 'node:test';import {createHash} from 'node:crypto';
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION,binary=process.env.QTERM_E2E_BUSYBOX_BINARY;
test('real BusyBox processes preserve multi-call applet identity and conservative undeclared-shell Stop',{skip:!distro||!binary},()=>{
  const metadata=JSON.parse(fs.readFileSync(new URL('../.tools.local/busybox-runtime/metadata.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),metadata.binarySha256);
  const payload={binary,sha256:metadata.binarySha256,owner:fs.readFileSync(new URL('../src-tauri/src/wsl_owner.py',import.meta.url),'utf8')};
  const code='import json,sys\nQTERM_RUNTIME_TEST=json.load(sys.stdin)\n'+fs.readFileSync(new URL('wsl-shell-runtime-tests.py',import.meta.url),'utf8');
  const result=spawnSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-c',code],{input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:60000});
  console.log(result.stderr);assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/Ran 3 tests/);
});
