/** xterm emits device replies through onData too. They belong to their own PTY.
 * A modified F3 can share a cursor-report encoding; onKey identifies that input.
 */
export function isTerminalReply(data:string,keyboardData?:string):boolean{
  if(data===keyboardData)return false;
  return /^\x1b\[(?:[?>]?[0-9;]*(?:[Rcnt]|\$y)|[IO])$/.test(data)||/^\x1b(?:\]|P)[\s\S]*(?:\x07|\x1b\\)$/.test(data);
}
