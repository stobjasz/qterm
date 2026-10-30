import type {LibraryEntry,LibraryIdentity,SessionPin} from "../ipc";
export const identityKey=(identity:LibraryIdentity)=>JSON.stringify([identity.provider,identity.environment,identity.id.toLowerCase()]);
export const environmentLabel=(environment:string)=>environment==="native"?"Native Windows":environment.startsWith("wsl:")?`WSL · ${environment.slice(4)}`:"Unknown environment";
export const projectKey=(entry:LibraryEntry)=>JSON.stringify([entry.environment,entry.project]);
export interface LibraryFilters{search:string;provider:string;environment:string;project:string;branch:string;pinnedOnly:boolean;discovered:boolean}
export function libraryEntries(entries:LibraryEntry[],pins:SessionPin[],filters:LibraryFilters):LibraryEntry[]{
  const pinned=new Set(pins.map(identityKey)),needle=filters.search.trim().toLowerCase();
  return entries.map(entry=>({...entry,pinned:pinned.has(identityKey(entry))})).filter(entry=>
    (filters.discovered||entry.remembered||entry.pinned)&&(!filters.pinnedOnly||entry.pinned)&&(filters.provider==="all"||entry.provider===filters.provider)&&
    (filters.environment==="all"||entry.environment===filters.environment)&&(filters.project==="all"||projectKey(entry)===filters.project)&&(filters.branch==="all"||(entry.branch??"<unknown>")===filters.branch)&&
    (!needle||[entry.title,entry.cwd,entry.project,entry.id,entry.branch,entry.lastPrompt,entry.environment].some(value=>value?.toLowerCase().includes(needle))))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.modified??b.seenAt??0)-(a.modified??a.seenAt??0));
}
