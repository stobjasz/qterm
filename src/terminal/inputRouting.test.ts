import {it,expect} from "vitest";
import {isTerminalReply} from "./inputRouting";
it("keeps terminal reports local while allowing user keys with the same encoding",()=>{
  for(const reply of ["\x1b[12;40R","\x1b[?1;2c","\x1b[>0;276;0c","\x1b[0n","\x1b[8;24;80t","\x1b[?2004;1$y","\x1b[I","\x1b[O","\x1b]11;rgb:0000/0000/0000\x1b\\","\x1bP1$r0m\x1b\\"]){expect(isTerminalReply(reply)).toBe(true);}
  expect(isTerminalReply("\x1b[1;2R","\x1b[1;2R")).toBe(false);
  for(const key of ["plain text","\r","\x1b[A","\x1b[1;5C","\x1b[200~literal text\x1b[201~"]){expect(isTerminalReply(key)).toBe(false);}
});
