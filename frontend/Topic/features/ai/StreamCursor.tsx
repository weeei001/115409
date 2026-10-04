/** 串流游標：AI 回覆寫入中，最後一個字後面閃爍的一條細線；用墨色（狀態，不是燈） */
export function StreamCursor() {
  return <span className="ml-0.5 inline-block h-4 w-0.5 bg-foreground align-text-bottom" style={{ animation: 'cursor-blink 1s step-end infinite' }} />;
}
