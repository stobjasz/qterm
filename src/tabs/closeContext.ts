import {paneIds,type PaneId,type Workspace} from "../workspace/workspace";

/** Identity of the exact terminals being reviewed, including a whole tab's members. */
export function closeContext(workspace:Workspace,what:"tab"|"pane",ids:PaneId[],terminalToken:(id:PaneId)=>string|undefined):string|undefined {
  if(!ids.length)return undefined;
  const targets=[];
  for(const id of ids){
    const pane=workspace.panes[id];
    const tab=workspace.tabs.find(tab=>paneIds(tab.root).includes(id));
    if(!pane||!tab)return undefined;
    targets.push([id,tab.id,pane.profileId,pane.environment,terminalToken(id)]);
  }
  const tab=workspace.tabs.find(tab=>paneIds(tab.root).includes(ids[0]));
  if(what==="tab"&&(!tab||paneIds(tab.root).length!==ids.length||paneIds(tab.root).some(id=>!ids.includes(id))))return undefined;
  return JSON.stringify(targets);
}
