import {it,expect} from "vitest";
import type {Config,LibraryEntry,Profile} from "../ipc";
import {nativeAgentContext,profileSupportsEnvironment,sourceEnabled,sightingContext,sessionEnvironment,sessionReference} from "./environments";
it("preserves captured menu identity and conservatively infers older references",()=>{
  expect(sessionEnvironment({environment:"wsl:ubuntu",profileId:"custom:edited",cwd:"C:/native-looking"})).toBe("wsl:ubuntu");expect(sessionEnvironment({profileId:"wsl:Ubuntu",cwd:"/work"})).toBe("wsl:ubuntu");expect(sessionEnvironment({profileId:"custom:edited",cwd:"/work"})).toBe("unknown");expect(sessionReference({id:"ABC",environment:"native",cwd:"C:/work"})).toEqual({id:"abc",environment:"native"});
});
it("only matches the captured execution environment, including custom distribution profiles",()=>{
  const linux={id:"custom:Linux",kind:"wsl",distribution:"Ubuntu"} as Profile,native={id:"pwsh",kind:"powershell"} as Profile;
  expect(profileSupportsEnvironment("wsl:ubuntu",linux)).toBe(true);expect(profileSupportsEnvironment("wsl:debian",linux)).toBe(false);expect(profileSupportsEnvironment("wsl:ubuntu",native)).toBe(false);expect(profileSupportsEnvironment("native",linux)).toBe(false);expect(profileSupportsEnvironment("unknown",native)).toBe(false);
});
it("source setting changes and history disablement invalidate a reviewed WSL source",()=>{
  const source={distribution:"Ubuntu",enabled:true,claudeHome:"/a",codexHome:"/b"},entry={provider:"codex",environment:"wsl:ubuntu",sourceConfig:JSON.stringify(source)} as LibraryEntry;
  const config={codexSessions:true,wslSources:[source]} as Config;expect(sourceEnabled(entry,config)).toBe(true);expect(sourceEnabled(entry,{...config,codexSessions:false})).toBe(false);expect(sourceEnabled(entry,{...config,wslSources:[{...source,codexHome:"/changed"}]})).toBe(false);expect(sourceEnabled(entry,{...config,wslSources:[{...source,enabled:false}]})).toBe(false);
});
it("native data lookups exclude WSL and unclassified profiles while preserving explicit sighting identity",()=>{
  expect(nativeAgentContext("native","powershell")).toBe(true);expect(nativeAgentContext("wsl:ubuntu","wsl")).toBe(false);expect(nativeAgentContext("native","other")).toBe(false);expect(sightingContext("native","other")).toBe("unknown");expect(sightingContext("wsl:ubuntu","wsl")).toBe("wsl:ubuntu");
});
