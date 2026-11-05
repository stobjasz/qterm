// Actual Windows/9p source and shared metadata; no mount table is mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
test('Windows-mounted source and Windows-mounted shared metadata cannot acquire Linux-only verification coverage',{skip:!distro},()=>{
  const parent=fs.realpathSync.native('.tools.local');
  const root=fs.mkdtempSync(path.join(parent,'wsl-verification-mount-'));
  try{
    const module=fs.readFileSync('src-tauri/src/wsl_repository.py','utf8');
    const proof=execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:module+`
import pathlib,shutil
root=subprocess.check_output(['/usr/bin/wslpath','-u','-a',${JSON.stringify(root)}],text=True).strip()
repo_git(root,['init','--quiet','--initial-branch=source'])
repo_git(root,['config','user.name','fixture']);repo_git(root,['config','user.email','fixture@example.invalid'])
pathlib.Path(root,'tracked.txt').write_text('one')
repo_git(root,['add','.']);repo_git(root,['-c','commit.gpgSign=false','commit','--quiet','-m','fixture'])
assert repository_capture(root)['files']==1
def refused(cwd):
    try:
        with RepositoryCoverage(cwd):pass
    except ValueError as error:
        assert 'cannot establish event coverage on filesystem' in str(error),str(error)
    else:raise AssertionError('Windows-mounted repository acquired Linux-only coverage')
refused(root)
temporary=tempfile.mkdtemp(prefix='qterm-wsl-crossfs-')
try:
    task=os.path.join(temporary,'Task')
    repo_git(root,['worktree','add','--quiet','-b','task',task])
    assert repository_capture(task)['files']==1
    refused(task)
finally:
    assert os.path.dirname(temporary)=='/tmp' and os.path.basename(temporary).startswith('qterm-wsl-crossfs-')
    shutil.rmtree(temporary)
print('SOURCE_AND_SHARED_METADATA_REFUSED')
`,encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(proof.trim(),'SOURCE_AND_SHARED_METADATA_REFUSED');
  }finally{
    const canonical=fs.realpathSync.native(root);
    assert.equal(path.dirname(canonical).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(canonical).startsWith('wsl-verification-mount-'));
    fs.rmSync(canonical,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});
