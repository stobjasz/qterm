import fs from "node:fs";
import type {wslLaunchFixture} from "./wsl-launch-fixture";
/** Signal only the exact recorded fixture supervisor, pinned and birth-checked. */
export function signalOwner(fixture:ReturnType<typeof wslLaunchFixture>,pause:boolean){
  const script=fs.readFileSync("src-tauri/src/wsl_owner.py","utf8");
  fixture.python(`import os,sys,signal
root=${JSON.stringify(fixture.root)};pid=int(open(root+'/owner.pid').read())
try:handle=os.pidfd_open(pid)
except ProcessLookupError:
    if ${pause?"True":"False"}:raise
    sys.exit(0)
try:
    args=open('/proc/'+str(pid)+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')
    fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()
    matches=args[1:5]==[b'-I',b'-S',b'-c',${JSON.stringify(script)}.encode()]
    if ${pause?"True":"False"}:
        assert matches
        open(root+'/owner-start','w').write(fields[19])
    elif not matches or fields[19]!=open(root+'/owner-start').read():sys.exit(0)
    signal.pidfd_send_signal(handle,signal.SIGSTOP if ${pause?"True":"False"} else signal.SIGCONT)
except (FileNotFoundError,ProcessLookupError):
    if ${pause?"True":"False"}:raise
finally:os.close(handle)`);
}
