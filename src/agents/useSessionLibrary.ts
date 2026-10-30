import {useCallback,useEffect,useRef,useState} from "react";
import {loadSessionLibrary,onSessionPinsChanged,pinLibrarySession,sessionPinsAction,sessionPinsSnapshot,type LibraryIdentity,type SessionLibrarySnapshot,type SessionPins} from "../ipc";
const empty:SessionPins={pins:[],revision:-1,error:null,recoveryRequired:false,backupPath:null};
export function useSessionLibrary(){
  const [pins,setPins]=useState(empty),[snapshot,setSnapshot]=useState<SessionLibrarySnapshot>(),[error,setError]=useState<string>();const sequence=useRef(0);
  const accept=useCallback((next:SessionPins)=>{setPins(current=>next.revision>=current.revision?next:current);return next;},[]);
  useEffect(()=>{let active=true;const listener=onSessionPinsChanged(next=>active&&accept(next));void listener.then(()=>sessionPinsSnapshot()).then(next=>active&&accept(next)).catch(e=>active&&setError(String(e)));return()=>{active=false;void listener.then(off=>off()).catch(()=>{});};},[accept]);
  const load=useCallback(async(refresh=false)=>{const request=++sequence.current;try{const next=await loadSessionLibrary(refresh);if(request===sequence.current){setSnapshot(next);accept(next.pins);setError(undefined);}return next;}catch(e){if(request===sequence.current)setError(String(e));throw e;}},[accept]);
  const pin=useCallback(async(identity:LibraryIdentity,value:boolean)=>{accept(await pinLibrarySession(identity,value));},[accept]);
  const act=useCallback(async(action:"retry"|"recover")=>accept(await sessionPinsAction(action)),[accept]);
  const flush=useCallback(async()=>{const next=accept(await sessionPinsSnapshot());if(next.error)throw new Error(next.error);},[accept]);
  useEffect(()=>{if(!pins.error)return;let active=true;const timer=window.setInterval(()=>void sessionPinsSnapshot().then(next=>active&&accept(next)).catch(()=>{}),5000);return()=>{active=false;window.clearInterval(timer);};},[pins.error,accept]);
  return{snapshot,pins,error,load,pin,act,flush};
}
