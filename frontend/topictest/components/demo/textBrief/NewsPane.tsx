import type { TaskPacket, TextBriefResponse } from '../../../lib/demo/textBriefTypes';
import styles from '../../../styles/textBriefDemo.module.css';
import { SYM_NAME } from './constants';
import { Card, DataTable, Hint, Note, Pill, RawJson, Tag, type Row } from './ui';

/** 走訪任意結構收集所有 `evidence_ids`，用來判斷哪幾則新聞真的被分析引用 */
function collectRefIds(node: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((v) => collectRefIds(v, into));
  } else if (node && typeof node === 'object') {
    Object.entries(node as Record<string, unknown>).forEach(([k, v]) => {
      if (k === 'evidence_ids' && Array.isArray(v)) v.forEach((id) => into.add(String(id)));
      else collectRefIds(v, into);
    });
  }
  return into;
}

export function NewsPane({
  data,
  packet,
}: {
  data: TextBriefResponse;
  packet: TaskPacket | null;
}) {
  if (!packet) {
    return (
      <Card title="用到的新聞">
        <Hint>這次的結果沒有附上原始資料，看不到當時用了哪些新聞。按上方的「開始分析」重跑一次就有了。</Hint>
      </Card>
    );
  }

  const news = packet.news ?? [];
  const refIds = collectRefIds(data.brief ?? {});
  const name = SYM_NAME[data.symbol] ?? '';

  // 哪些交易日掛到了這則新聞：後端在 build_daily_timeline 依日期掛上去
  const dayOf = new Map<string, string[]>();
  (packet.daily_timeline ?? []).forEach((d) =>
    (d.news ?? []).forEach((id) => {
      const list = dayOf.get(id) ?? [];
      list.push(`${d.id} · ${d.date}`);
      dayOf.set(id, list);
    }),
  );

  const hit = (t?: string) => !!t && (t.includes(data.symbol) || (!!name && t.includes(name)));
  let titleHits = 0;
  let textHits = 0;
  let anyHits = 0;
  let cited = 0;
  let attached = 0;

  const rows: Row[] = news.map((n) => {
    const inTitle = hit(n.title);
    const inText = hit(n.value);
    if (inTitle) titleHits++;
    if (inText) textHits++;
    if (inTitle || inText) anyHits++;
    if (refIds.has(n.id)) cited++;
    if (dayOf.has(n.id)) attached++;
    return {
      key: n.id,
      mark: !(inTitle || inText),
      cells: [
        { content: n.id, cls: styles.id },
        { content: n.date },
        { content: n.kind },
        { content: (dayOf.get(n.id) ?? []).join('、') || '—' },
        { content: refIds.has(n.id) ? <Pill tone="y">有</Pill> : <Pill tone="m">無</Pill> },
        { content: inTitle ? <Pill tone="y">是</Pill> : <Pill tone="n">否</Pill> },
        { content: inText ? <Pill tone="y">是</Pill> : <Pill tone="n">否</Pill> },
        { content: n.title, cls: styles.wrapcell },
        { content: n.value, cls: styles.wrapcell },
      ],
    };
  });

  return (
    <div>
      <Card title="用到的新聞　（這次找出來、而且真的送進 AI 的全部新聞）">
        <div className={styles.sumline}>
          <Tag>共 {news.length} 則</Tag>
          <Tag tone={titleHits ? 'ok' : 'bad'}>標題提到本檔 {titleHits} 則</Tag>
          <Tag tone={textHits ? 'ok' : 'bad'}>送進 AI 的內容提到本檔 {textHits} 則</Tag>
          <Tag tone={anyHits === news.length ? 'ok' : 'warn'}>
            標題或內容至少一處提到 {anyHits} 則
          </Tag>
          <Tag>有對到交易日 {attached} 則</Tag>
          <Tag tone={cited ? 'info' : 'plain'}>分析中有引用 {cited} 則</Tag>
        </div>
        <Note>
          「提到本檔」只是純粹比對文字裡有沒有出現 {data.symbol}
          {name ? ` 或「${name}」` : ''}
          ，用來看找回來的新聞到底有沒有在講這檔股票。灰底那幾列代表標題和內容都沒提到，
          也就是抓到的其實是大盤消息，不是這檔的新聞。最後一欄就是 AI 實際讀到的全部文字，
          是搜尋系統回傳的段落，不是整篇文章。
        </Note>
        <DataTable
          headers={[
            'id',
            '日期',
            '類型',
            '對到哪一個交易日',
            '分析有引用',
            '標題提到',
            '內容提到',
            '標題',
            '送進 AI 的內容',
          ]}
          rows={rows}
        />
      </Card>
      <Card>
        <RawJson label="展開新聞的原始資料（JSON）" value={news} />
      </Card>
    </div>
  );
}
