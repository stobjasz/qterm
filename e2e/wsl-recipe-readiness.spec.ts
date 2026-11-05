// R115: real Linux FIFO service, observed output, exact PID birth and scoped Stop.
import {expect,test} from './qterm';
import {reviewRecipe,launchRecipe} from './recipe-fixture';
import {wslRecipeFixture} from './wsl-recipe-fixture';
for(const mode of ['ready','cancel','timeout'] as const)test.describe(mode,()=>{
  const fixture=wslRecipeFixture();test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
  test.beforeAll(()=>{
    fixture.seed();if(!fixture.distro)return;
    const service=`import os,json,pathlib
root=pathlib.Path(__file__).resolve().parent
fields=pathlib.Path('/proc/self/stat').read_text().rpartition(') ')[2].split()
(root/'target/service.json').write_text(json.dumps({'pid':os.getpid(),'start':fields[19]}))
print('LINUX_SERVICE_WAITING_'+str(6*7),flush=True)
with open(root/'target/release') as f:f.readline()
print('LINUX_SERVICE_READY_'+str(6*7),flush=True)
with open(root/'target/finish') as f:f.readline()
`;
    const client=`import pathlib
root=pathlib.Path(__file__).resolve().parent
(root/'target/client').write_text('executed')
print('LINUX_READY_CLIENT_'+str(6*7),flush=True)
`;
    fixture.python(`import os
root=${JSON.stringify(fixture.project)};os.mkfifo(root+'/target/finish',0o600)
open(root+'/service.py','w').write(${JSON.stringify(service)})
open(root+'/client.py','w').write(${JSON.stringify(client)})
open(root+'/.qterm.toml','w').write(${JSON.stringify(fixture.source([{name:'service',command:'python3 service.py',ready_output:'LINUX_SERVICE_READY_42',timeout_seconds:mode==='timeout'?1:60},{name:'client',command:'python3 client.py',depends_on:['service']}]))})`);
  });test.afterAll(fixture.cleanup);
  const exists=(name:string)=>fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.project}/target/`)}+${JSON.stringify(name)}))`)==='True';
  const alive=()=>fixture.python(`import json,os
owner=json.load(open(${JSON.stringify(`${fixture.project}/target/service.json`)}))
try:
    fields=open('/proc/'+str(owner['pid'])+'/stat').read().rpartition(') ')[2].split()
    print(fields[0]!='Z' and fields[19]==owner['start'])
except FileNotFoundError:print(False)`)==='True';
  test(`Linux ${mode} readiness preserves dependency and explicit Stop boundaries`,async({qterm})=>{
    const original=await fixture.ready(qterm),panel=await reviewRecipe(qterm.page,fixture.project,'custom:WSL launch'),run=await launchRecipe(panel);
    const service=run.getByLabel('Workflow step service',{exact:true}),client=run.getByLabel('Workflow step client',{exact:true});
    await expect.poll(()=>exists('service.json')).toBe(true);expect(alive()).toBe(true);await expect(client.getByLabel('Recipe step state',{exact:true})).toHaveText('pending');expect(exists('client')).toBe(false);
    if(mode==='cancel'){
      await run.getByRole('button',{name:'Cancel pending steps',exact:true}).click();fixture.release();await expect(service.getByLabel('Recipe step state',{exact:true})).toHaveText('ready');await expect(client.getByLabel('Recipe step state',{exact:true})).toHaveText('cancelled');expect(exists('client')).toBe(false);
    }else if(mode==='timeout'){
      await expect(service.getByLabel('Recipe step state',{exact:true})).toHaveText('timed_out');await expect(client.getByLabel('Recipe step state',{exact:true})).toHaveText('blocked');expect(exists('client')).toBe(false);
    }else{
      fixture.release();await expect(service.getByLabel('Recipe step state',{exact:true})).toHaveText('ready');await expect(client.getByLabel('Recipe step state',{exact:true})).toHaveText('succeeded');expect(exists('client')).toBe(true);
    }
    expect(alive()).toBe(true);await run.getByRole('button',{name:'Stop workflow',exact:true}).click();await expect.poll(alive).toBe(false);
    await panel.getByRole('button',{name:'Close recipes',exact:true}).click();await qterm.page.getByRole('tab').nth(0).click();expect(await qterm.activePane()).toBe(original);await qterm.run(original,"printf 'OTHER_RECIPE_SHELL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(original)).toContain('OTHER_RECIPE_SHELL_42');
  });
});
