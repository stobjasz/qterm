import type {Config,LibraryEntry,Profile,SessionReference} from "../ipc";
export function sessionEnvironment(session:{environment?:string|null;profileId?:string;cwd:string|null}):string{
  if(session.environment!==undefined&&session.environment!==null)return session.environment;
  if(session.profileId?.startsWith("wsl:")&&session.profileId.length>4)return session.profileId.toLowerCase();
  return session.cwd&&/^[A-Za-z]:[\\/]/.test(session.cwd)?"native":"unknown";
}
export const sessionReference=(session:{id:string;environment?:string|null;profileId?:string;cwd:string|null}):SessionReference=>({id:session.id.toLowerCase(),environment:sessionEnvironment(session)});
export type SourceContext=Pick<LibraryEntry,"key"|"sourceVersion"|"sourceConfig"|"provider"|"environment">;
export function sourceContext(source:LibraryEntry):SourceContext{const {key,sourceVersion,sourceConfig,provider,environment}=source;return{key,sourceVersion,sourceConfig,provider,environment};}
export function nativeAgentContext(environment:string|undefined,kind:Profile["kind"]|undefined):boolean{return environment==="native"&&kind!==undefined&&kind!=="other"&&kind!=="wsl";}
export function sightingContext(environment:string|undefined,kind:Profile["kind"]|undefined):string{return kind==="other"||!kind?"unknown":environment??"unknown";}
export function profileSupportsEnvironment(environment:string,profile:Profile):boolean{
  if(environment==="native")return profile.kind!=="wsl"&&profile.kind!=="other";
  const distribution=profile.distribution??(profile.id.startsWith("wsl:")?profile.id.slice(4):undefined);
  return environment.startsWith("wsl:")&&profile.kind==="wsl"&&distribution?.toLowerCase()===environment.slice(4);
}
export function sourceEnabled(source:Pick<LibraryEntry,"provider"|"environment"|"sourceConfig">,config:Config|undefined):boolean{
  if(!config||!(source.provider==="claude"?config.claudeSessions:config.codexSessions))return false;
  return source.environment==="native"||(config.wslSources??[]).some(candidate=>candidate.enabled&&`wsl:${candidate.distribution.toLowerCase()}`===source.environment&&JSON.stringify(candidate)===source.sourceConfig);
}
