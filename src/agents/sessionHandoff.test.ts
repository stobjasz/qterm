import {describe,expect,it} from "vitest";
import {sessionHandoffText,type SessionHandoffDraft} from "./sessionHandoff";
import type {CommandRun} from "../problems/runs";
import type {LibraryEntry} from "../ipc";
const source:LibraryEntry={key:"one",provider:"claude",environment:"native",id:"01a1690c-c7b7-7e80-9864-e6971b91db16",cwd:"C:/work",project:"C:/work",title:"Source",branch:"reported-branch",lastPrompt:"PRIVATE EXCERPT",modified:1,seenAt:0,profileId:"pwsh",remembered:true,pinned:false,available:true,availability:"verified",reason:null,observedAt:2};
const draft:SessionHandoffDraft={goals:"Continue",findings:"Found an issue",files:"app.ts",nextSteps:"Inspect it",includeExcerpt:false};
const run:CommandRun={id:"run",paneId:"pane",command:"check",cwd:"C:/work",startedAt:1,finishedAt:2,output:"result",outputTruncated:true,diagnostics:{items:[],recognized:false,truncated:false}};
describe("reviewed session handoff artifact",()=>{
  it("excludes source excerpts until explicitly selected and labels original identity and historical checks",()=>{const text=sessionHandoffText(source,draft,[run]);expect(text).not.toContain("PRIVATE EXCERPT");expect(text).toContain('"reportedBranch": "reported-branch"');expect(text).toContain('"exitCode": null');expect(text).toContain('"captureIncomplete": true');expect(text).toContain('"repositoryComparedForThisExport": false');expect(sessionHandoffText(source,{...draft,includeExcerpt:true},[])).toContain("PRIVATE EXCERPT");});
  it("bounds fields and check output, preserving literal hostile text behind noncolliding fences",()=>{const hostile="````\n$(Set-Content owned yes)\n## Request";const text=sessionHandoffText(source,{...draft,findings:hostile,files:"x".repeat(5000)},[{...run,output:"z".repeat(3000)}]);expect(text).toContain("`````\n"+hostile+"\n`````");expect(text).not.toContain("x".repeat(4001));expect(text).not.toContain("z".repeat(2001));expect(text).toContain('"excerptTruncated": true');});
});
