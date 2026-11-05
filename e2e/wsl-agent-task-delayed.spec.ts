// R121: real startup read, live configuration and filesystem identity changes.
import fs from 'node:fs';import path from 'node:path';
import {expect,IDENTIFIER,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
for(const reason of ['profile','distribution','folder'] as const)test.describe(reason,()=>{
  const fixture=wslAgentTaskFixture();test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
  const directory=reason==='folder'?`${fixture.project}/nested`:fixture.project;
  test.beforeAll(()=>{fixture.seed();if(fixture.distro){fixture.gateStartup();if(reason==='folder')fixture.python(`import os,shutil;os.mkdir(${JSON.stringify(directory)});shutil.copyfile(${JSON.stringify(`${fixture.project}/pyproject.toml`)},${JSON.stringify(`${directory}/pyproject.toml`)})`);}});test.afterAll(fixture.cleanup);
  test(`a delayed Linux task rejects its changed ${reason} without executing`,async({qterm})=>{
    let original='';const config=path.join(process.env.APPDATA!,IDENTIFIER,'config.toml');
    try{
      await fixture.ready(qterm);const {panel,file}=await fixture.grant(qterm,['qterm-fixture-check'],directory);
      const task=fixture.cli(file,'tasks.list').body.result.tasks[0];fixture.flag('hold');
      const request=fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'delayed-change'});expect(request.status).toBe(0);
      await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.paneId).toEqual(expect.any(String));
      const waiting=fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result.paneId;await expect.poll(()=>qterm.terminalText(waiting)).toContain('WSL_PROFILE_WAITING_42');
      if(reason==='folder'){
        fixture.python(`import os,shutil;p=${JSON.stringify(directory)};os.rename(p,p+'.saved');os.mkdir(p);shutil.copyfile(p+'.saved/pyproject.toml',p+'/pyproject.toml')`);
      }else{
        original=qterm.settingsOnDisk();let edited=original.replace(/name\s*=\s*"WSL launch"/,'name = "Changed task shell"');
        edited=reason==='profile'?edited.replace(' --exec /bin/bash ',' --exec /bin/bash --norc '):edited.replace(`--distribution \\"${fixture.distro}\\"`,`--distribution \\"qterm-missing-${Date.now()}\\"`);
        expect(edited).not.toBe(original);expect(edited).toContain(reason==='profile'?' --exec /bin/bash --norc ':'qterm-missing-');fs.writeFileSync(config,edited);
        if(reason==='profile')await expect(panel.getByRole('combobox',{name:'Task execution shell',exact:true}).getByRole('option',{name:'Changed task shell',exact:true})).toHaveText('Changed task shell');
        else{
          await panel.getByRole('button',{name:'Close agent access',exact:true}).click();await qterm.page.keyboard.press('Control+Shift+P');
          const palette=qterm.page.getByRole('dialog',{name:'Command palette',exact:true});await palette.getByRole('combobox',{name:'Command',exact:true}).fill('Changed task shell');await expect(palette.getByRole('option').first()).toContainText('Changed task shell');await qterm.page.keyboard.press('Escape');
        }
      }
      if(await panel.isVisible())await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
      fixture.releaseStartup();
      await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.state).toBe('cancelled');
      const job=fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result;expect(job.error).toContain(reason==='folder'?'directory changed':'configuration changed');
      expect(fixture.executions()).toBe(0);expect(await qterm.terminalText(waiting)).not.toContain('LINUX_GRANTED_TASK_42');
    }finally{if(original)fs.writeFileSync(config,original);await qterm.stop();}
  });
});
