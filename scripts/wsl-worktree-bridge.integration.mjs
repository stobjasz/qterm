// Opt-in Node-runner Linux/Git boundary checks, separate from Vitest unit tests.
// The desktop specs cover durable task storage, UI and profile guards separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const bridge=fs.readFileSync(new URL('../src-tauri/src/wsl_repository.py',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../src-tauri/src/wsl_bridge.py',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../src-tauri/src/wsl_bootstrap.py',import.meta.url),'utf8');
function python(source){return execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-'],{input:source,encoding:'utf8',windowsHide:true,timeout:30000});}
function call(request){
  const response=JSON.parse(execFileSync('wsl.exe',['--distribution',distro,'--exec','/usr/bin/python3','-I','-S','-c',bootstrap],{input:JSON.stringify({source:bridge,request}),encoding:'utf8',windowsHide:true,timeout:30000}));
  if(response.error)throw Error(response.error);
  return response.result;
}
test('WSL worktree bridge preserves dirty files, rejects obsolete previews and never executes repository programs',{skip:!distro},()=>{
  const root=python(`import tempfile;print(tempfile.mkdtemp(prefix='qterm-wsl-worktree-'))`).trim();
  const repo=`${root}/Case source`,target=`${root}/Case task`;
  const run=source=>python(`root=${JSON.stringify(root)}\nrepo=${JSON.stringify(repo)}\ntarget=${JSON.stringify(target)}\n${source}`);
  const preview=(directory=target,branch='qterm/task',base='HEAD')=>call({method:'worktree_preview',cwd:repo,directory,branch,base});
  const exists=file=>run(`import os;print(os.path.lexists(${JSON.stringify(file)}))`).trim()==='True';
  try{
    run(`import os,subprocess,shlex
os.mkdir(repo)
env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
def git(*args): subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false',*args],cwd=repo,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
git('init','--quiet','--initial-branch=source');git('config','user.email','fixture@example.invalid');git('config','user.name','fixture')
with open(repo+'/tracked.txt','w') as f:f.write('committed content')
with open(repo+'/.gitattributes','w') as f:f.write('tracked.txt filter=trip\\n')
os.symlink('tracked.txt',repo+'/link.txt')
git('add','.');git('commit','--quiet','-m','fixture')
script=root+'/forbidden.sh'
with open(script,'w') as f:f.write('#!/bin/sh\\ntouch '+shlex.quote(root+'/must-not-run')+'\\ncat\\n')
os.chmod(script,0o700)
git('config','core.fsmonitor',script)
for key in ('clean','smudge','process'):git('config','filter.trip.'+key,script)
git('config','filter.trip.required','true')
for hook in ('post-checkout','reference-transaction'):
    os.symlink(script,repo+'/.git/hooks/'+hook)
with open(repo+'/tracked.txt','w') as f:f.write('dirty source')
with open(repo+'/untracked.txt','w') as f:f.write('untracked source')`);
    const p=preview();
    assert.equal(p.repository,repo);assert.equal(p.directory,target);assert.equal(p.branch,'qterm/task');assert.equal(p.sourceDirty,true);
    assert.match(p.commit,/^[0-9a-f]{40,64}$/);assert.equal(exists(target),false);assert.equal(exists(`${root}/must-not-run`),false);
    for(const name of ['@{-1}','--orphan','bad branch','x..y'])assert.throws(()=>preview(target,name));
    for(const dest of [repo,`${repo}/nested`,`${repo}/.git/new`,`${root}/../escape`])assert.throws(()=>preview(dest));
    run(`import os;os.symlink(root+'/absent',root+'/dangling')`);assert.throws(()=>preview(`${root}/dangling`),/already exists/);
    const moved=preview(`${root}/moved-base`,'qterm/moved');
    run(`import subprocess;subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false','commit','--allow-empty','--quiet','-m','moved'],cwd=repo,check=True)`);
    assert.throws(()=>call({method:'worktree_create',preview:moved}),/base or destination parent changed/);assert.equal(exists(moved.directory),false);
    const replacedSource=preview(`${root}/replaced-source`,'qterm/source');
    run(`import os,shutil;os.rename(repo,root+'/original-source');shutil.copytree(root+'/original-source',repo,symlinks=True)`);
    assert.throws(()=>call({method:'worktree_create',preview:replacedSource}),/Repository, base or destination parent changed/);assert.equal(exists(replacedSource.directory),false);
    run(`import os,shutil;shutil.rmtree(repo);os.rename(root+'/original-source',repo)`);
    run(`import os;os.mkdir(root+'/parent')`);
    const replaced=preview(`${root}/parent/task`,'qterm/parent');
    run(`import os;os.rename(root+'/parent',root+'/original-parent');os.mkdir(root+'/parent')`);
    assert.throws(()=>call({method:'worktree_create',preview:replaced}),/parent changed/);assert.equal(exists(replaced.directory),false);
    const reviewed=preview();
    call({method:'worktree_create',preview:reviewed});
    assert.equal(run(`print(open(target+'/tracked.txt').read())`).trim(),'committed content');
    assert.equal(run(`print(open(repo+'/tracked.txt').read())`).trim(),'dirty source');
    assert.equal(exists(`${repo}/untracked.txt`),true);assert.equal(exists(`${target}/untracked.txt`),false);
    assert.equal(run(`import os;print(os.path.islink(target+'/link.txt'));print(open(target+'/link.txt').read())`).trim(),'False\ntracked.txt');
    assert.equal(exists(`${root}/must-not-run`),false);
    run(`with open(target+'/tracked.txt','w') as f:f.write('task changes')
with open(target+'/new.txt','w') as f:f.write('task untracked')`);
    const details=call({method:'worktree_details',task:reviewed});
    assert.equal(details.branch,'qterm/task');assert.equal(details.changed,1);assert.equal(details.untracked,1);assert.match(details.summary,/tracked.txt/);assert.equal(details.commits,'0');
    assert.equal(exists(`${root}/must-not-run`),false);
    assert.throws(()=>preview(`${root}/duplicate`),/branch already exists/);
    assert.throws(()=>call({method:'worktree_details',task:{...reviewed,commonDir:root}}),/no longer the recorded worktree/);
    assert.throws(()=>call({method:'worktree_details',task:{...reviewed,commonIdentity:[0,0]}}),/no longer the recorded worktree/);
    assert.throws(()=>call({method:'worktree_create',preview:reviewed}),/branch already exists|destination already exists/);
    assert.equal(run(`print(open(target+'/tracked.txt').read())`).trim(),'task changes');
  }finally{
    run(`import os,shutil
resolved=os.path.realpath(root)
assert resolved==root and os.path.dirname(resolved)=='/tmp' and os.path.basename(resolved).startswith('qterm-wsl-worktree-')
shutil.rmtree(resolved)`);
  }
});
