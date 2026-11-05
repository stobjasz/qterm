import fs from "node:fs";
import type {wslVerificationFixture} from "./wsl-verification-fixture";
export interface VerificationMonitor {pid:number;start:string}
/** Observe only bundled helpers watching this unique fixture's root and source inode.
 * Signals additionally pin the observed birth identity with a kernel PID descriptor.
 * Cleanup is called after assertions and never provides acceptance evidence. */
export function verificationMonitors(fixture:ReturnType<typeof wslVerificationFixture>){
  const bootstrap=fs.readFileSync("src-tauri/src/wsl_bootstrap.py","utf8");
  const guard=`import os,json,re,signal
bootstrap=${JSON.stringify(bootstrap)}.encode()
root=${JSON.stringify(fixture.project)}
inodes={os.stat(root).st_ino,os.stat(root+'/value.txt').st_ino}
assert len(inodes)==2
def matches(pid):
    p='/proc/'+str(pid)
    if os.stat(p).st_uid!=os.getuid():return None
    args=open(p+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')
    if len(args)<5 or args[-4:-1]!=[b'-I',b'-S',b'-c'] or args[-1]!=bootstrap:return None
    fields=open(p+'/stat').read().rpartition(') ')[2].split()
    if fields[0]=='Z':return None
    for fd in os.listdir(p+'/fd'):
        try:
            if os.readlink(p+'/fd/'+fd)!='anon_inode:inotify':continue
            info=open(p+'/fdinfo/'+fd).read()
            watched={int(value,16) for value in re.findall(r'(?<![a-z])ino:([0-9a-f]+)',info)}
            if inodes<=watched:return {'pid':pid,'start':fields[19]}
        except (FileNotFoundError,PermissionError):pass
    return None
`;
  const observed=new Map<string,VerificationMonitor>();
  function list():VerificationMonitor[]{
    const result:VerificationMonitor[]=JSON.parse(fixture.python(guard+`
found=[]
for name in os.listdir('/proc'):
    if not name.isdigit():continue
    try:
        result=matches(int(name))
        if result:found.append(result)
    except (FileNotFoundError,ProcessLookupError,PermissionError):pass
print(json.dumps(found))`));
    for(const monitor of result)observed.set(`${monitor.pid}:${monitor.start}`,monitor);
    return result;
  }
  function end(monitor:VerificationMonitor){
    fixture.python(guard+`
pid=${monitor.pid};start=${JSON.stringify(monitor.start)}
try:handle=os.pidfd_open(pid)
except ProcessLookupError:raise SystemExit(0)
try:
    current=matches(pid)
    if current and current['start']==start:signal.pidfd_send_signal(handle,signal.SIGKILL)
except (FileNotFoundError,ProcessLookupError):pass
finally:os.close(handle)`);
  }
  return{list,end,cleanup:()=>{for(const monitor of observed.values())end(monitor);}};
}
