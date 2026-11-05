import {wslVerificationFixture} from "./wsl-verification-fixture";
import type {RecipeStep} from "./recipe-fixture";
export function wslRecipeFixture(){
  const base=wslVerificationFixture();
  const relative='..\\literal',folder=`${base.project}/${relative}`;
  const source=(steps:RecipeStep[],layout="rows")=>['[workflows]','version = 1','[[workflows.recipes]]','name = "pipeline"',`layout = ${JSON.stringify(layout)}`,...steps.flatMap(step=>['[[workflows.recipes.steps]]',...Object.entries(step).map(([key,value])=>`${key} = ${JSON.stringify(value)}`)])].join('\n');
  function seed(){
    base.seed();if(!base.distro)return;
    const build=`import pathlib,os,json
root=pathlib.Path(__file__).resolve().parent
(root/'target/build.json').write_text(json.dumps({'pid':os.getpid(),'start':pathlib.Path('/proc/self/stat').read_text().rpartition(') ')[2].split()[19]}))
print('LINUX_RECIPE_WAITING_'+str(6*7),flush=True)
with open(root/'target/release') as f:f.readline()
(root/'target/order').write_text('build\\n')
print('LINUX_RECIPE_BUILD_'+str(6*7),flush=True)
`;
    const finish=`import pathlib
root=pathlib.Path(__file__).resolve().parent
assert (root/'target/order').read_text()=='build\\n'
with open(root/'target/order','a') as f:f.write('check\\n')
print('LINUX_RECIPE_CHECK_'+str(int((root/'value.txt').read_text())*2),flush=True)
`;
    base.python(`import os
root=${JSON.stringify(base.project)}
os.mkdir(root+'/target');os.mkfifo(root+'/target/release',0o600)
os.mkdir(${JSON.stringify(folder)})
open(root+'/build.py','w').write(${JSON.stringify(build)})
open(root+'/finish.py','w').write(${JSON.stringify(finish)})
open(root+'/.qterm.toml','w').write(${JSON.stringify(source([{name:'build',command:'python3 build.py'},{name:'check',command:'python3 ../finish.py',cwd:relative,depends_on:['build']}]))})`);
  }
  const read=(name:string)=>base.python(`print(open(${JSON.stringify(`${base.project}/target/`)}+${JSON.stringify(name)}).read(),end='')`);
  const release=()=>base.python(`with open(${JSON.stringify(`${base.project}/target/release`)},'w') as f:f.write('finish\\n')`);
  return{...base,folder,seed,source,read,release};
}
