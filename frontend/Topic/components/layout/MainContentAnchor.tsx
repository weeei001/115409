/** 「跳至主要內容」（pages/_document.tsx）的目標 id */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * skip link 的落點：放在頁首（含標題區）之後，跳過去下一個 Tab 就是內容，不必再走過頁首的 11 個按鈕（03-F6）。
 * 頁首是 sticky，落點要留出頁首高度，捲過去才不會被蓋住。
 */
export function MainContentAnchor() {
  return <div id={MAIN_CONTENT_ID} tabIndex={-1} className="scroll-mt-[var(--app-header-height)] outline-none" />;
}

/** 讓焦點回到內容開頭（例如「回到頁面頂部」之後），不另外捲動 */
export function focusMainContent() {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
}
