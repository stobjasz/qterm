// R114: edit actual definitions/config while the first Linux command waits.
import fs from 'node:fs';import path from 'node:path';
import {expect,IDENTIFIER,test} from './qterm';
import {reviewRecipe,launchRecipe} from './recipe-fixture';
import {wslRecipeFixture} from './wsl-recipe-fixture';
for(const reason of ['definition','profile'] as const)test.describe(reason,()=>{
  const fixture=wslRecipeFixture();test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
  test(`a changed Linux workflow ${reason} blocks its delayed dependent without executing it`,async({qterm})=>{
    let original='';const file=path.join(process.env.APPDATA!,IDENTIFIER,'config.toml');
    try{
      await fixture.ready(qterm);const panel=await reviewRecipe(qterm.page,fixture.project,'custom:WSL launch'),run=await launchRecipe(panel);
      await expect(run.getByLabel('Workflow step build',{exact:true}).getByLabel('Recipe step state',{exact:true})).toHaveText('running');
      await expect.poll(()=>fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.project}/target/release`)}))`)).toBe('True');
      if(reason==='definition')fixture.python(`p=${JSON.stringify(`${fixture.project}/.qterm.toml`)};text=open(p).read();open(p,'w').write(text.replace('python3 ../finish.py','python3 ../finish.py --changed'))`);
      else{
        original=qterm.settingsOnDisk();fs.writeFileSync(file,original.replace(/name\s*=\s*"WSL launch"/,'name = "Changed recipe shell"').replace(' --exec /bin/bash ',' --exec /bin/bash --norc '));
        await expect(panel.getByRole('combobox',{name:'Recipe shell',exact:true}).getByRole('option',{name:'Changed recipe shell',exact:true})).toHaveText('Changed recipe shell');
      }
      fixture.release();const check=run.getByLabel('Workflow step check',{exact:true});await expect(check.getByLabel('Recipe step state',{exact:true})).toHaveText('failed');await expect(check).toContainText(reason==='definition'?'source or project changed':'shell configuration changed');expect(fixture.read('order')).toBe('build');
      await panel.getByRole('button',{name:'Close recipes',exact:true}).click();const pane=Object.values((await qterm.workspace()).panes).find(pane=>pane.cwd===fixture.folder)!;
      await qterm.run(pane.id,"printf 'GUARDED_RECIPE_SHELL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane.id)).toContain('GUARDED_RECIPE_SHELL_42');expect(await qterm.terminalText(pane.id)).not.toContain('LINUX_RECIPE_CHECK_42');
    }finally{if(original)fs.writeFileSync(file,original);await qterm.stop();}
  });
});
