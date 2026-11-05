import {wslLaunchFixture} from "./wsl-launch-fixture";

/** Real quiet ELF programs with provider image names; never invokes a provider. */
export function wslProviderFixture(){
  const fixture=wslLaunchFixture();
  function seed(){
    if(!fixture.distro)return;
    fixture.seed();
    fixture.python(`import os,shutil
root=${JSON.stringify(fixture.root)}
for provider in ('claude','codex'):
    shutil.copy2('/usr/bin/python3',root+'/bin/'+provider)
    os.chmod(root+'/bin/'+provider,0o700)`);
  }
  return{...fixture,seed};
}
