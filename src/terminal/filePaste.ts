import type {ShellKind} from "../ipc";
import {dropText} from "./drop";
import type {TranslatePaths} from "../workspace/shellCwd";

export interface FileDestination{id:string;session:number;submission:number;environment:string;kind:ShellKind}
export function deliverFilePaste(prepared:{id:string;text:string}[],captured:FileDestination[],current:FileDestination[],paste:(id:string,text:string)=>void):void{
  if(JSON.stringify(captured)!==JSON.stringify(current))throw Error("A destination or broadcast group changed while file paths were being prepared; nothing was pasted.");
  for(const item of prepared)paste(item.id,item.text);
}
/** Prepare every destination first. A translation failure never delivers a partial paste. */
export async function prepareFilePaste(paths:string[],destinations:FileDestination[],translate:TranslatePaths):Promise<{id:string;text:string}[]>{
  if(!paths.length||paths.length>64||!destinations.length||destinations.length>64)throw Error("File paste supports 1–64 files and destinations.");
  const result:{id:string;text:string}[]=[],translated=new Map<string,string[]>();
  for(const destination of destinations){
    let actual=paths;
    if(destination.environment.startsWith("wsl:")){
      const distribution=destination.environment.slice(4);
      actual=translated.get(distribution)??await translate(distribution,paths,true);
      if(actual.length!==paths.length)throw Error("WSL returned a different file count.");
      translated.set(distribution,actual);
    }else if(destination.environment!=="native")throw Error("The destination environment is unknown.");
    result.push({id:destination.id,text:dropText(actual,destination.kind)});
  }
  return result;
}
