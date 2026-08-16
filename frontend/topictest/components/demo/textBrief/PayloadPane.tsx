import type { EvidenceItem, TaskPacket } from '../../../lib/demo/textBriefTypes';
import styles from '../../../styles/textBriefDemo.module.css';
import { FIELD } from './constants';
import { Card, DataTable, Hint, Note, RawJson, Tag, num, type Row } from './ui';

/** 基本面／長期座標那幾張表右邊的「其他」欄 */
function extras(it: EvidenceItem): string {
  const bits: string[] = [];
  if (it.period) bits.push(it.period);
  if (it.yoy_pct != null) bits.push(`年增 ${it.yoy_pct}%`);
  if (it.mom_pct != null) bits.push(`月增 ${it.mom_pct}%`);
  if (it.qoq_pct != null) bits.push(`季增 ${it.qoq_pct}%`);
  if (it.pct_rank_1y != null) bits.push(`近一年第 ${it.pct_rank_1y} 百分位`);
  (it.last4q ?? it.yoy_last6 ?? []).forEach(([k, v]) => bits.push(`${k} ${v}`));
  return bits.join('、') || '—';
}

function itemRows(list?: EvidenceItem[]): Row[] {
  return (list ?? []).map((it) => ({
    key: it.id,
    cells: [
      { content: it.id, cls: styles.id },
      { content: FIELD[it.field] ?? it.field },
      { content: it.date ?? it.period ?? '—' },
      {
        content: it.value == null ? '—' : Number(it.value).toLocaleString(),
        cls: styles.num,
      },
      { content: extras(it), cls: styles.wrapcell },
    ],
  }));
}

export function PayloadPane({ packet }: { packet: TaskPacket | null }) {
  if (!packet) {
    return (
      <Card title="給 AI 看的資料">
        <Hint>這次的結果沒有附上原始資料，看不到 AI 當時看到什麼。按上方的「開始分析」重跑一次就有了。</Hint>
      </Card>
    );
  }

  const task = packet.task;
  const missing = packet.missing_fields ?? [];

  const timeline: Row[] = (packet.daily_timeline ?? []).map((d) => ({
    key: d.id,
    mark: (d.news ?? []).length > 0,
    cells: [
      { content: d.id, cls: styles.id },
      { content: d.date },
      num(d.close),
      num(d.chg_pct, 2),
      num(d.vol_lots),
      num(d.vol_vs_ma5_pct, 1),
      num(d.foreign_net_lots),
      num(d.trust_net_lots),
      num(d.dealer_net_lots),
      num(d.vs_ma20_pct, 1),
      { content: (d.news ?? []).join('、') || '—' },
    ],
  }));

  const anchorHeaders = ['id', '項目', '日期', '數值', '其他'];

  return (
    <div>
      <Card title="這次給 AI 看的資料">
        <div className={styles.sumline}>
          <Tag>
            {task?.symbol}　分析到 {task?.as_of_date}
          </Tag>
          <Tag>交易日 {(packet.daily_timeline ?? []).length} 天</Tag>
          <Tag>長期位置 {(packet.long_term_anchor ?? []).length} 項</Tag>
          <Tag>基本面 {(packet.fundamental ?? []).length} 項</Tag>
          <Tag>新聞 {(packet.news ?? []).length} 則</Tag>
          <Tag tone={missing.length ? 'warn' : 'ok'}>
            {missing.length ? `缺少的資料：${missing.join('、')}` : '資料沒有缺'}
          </Tag>
        </div>
        <Note>這就是 AI 看到的全部內容。這裡沒有的資料，AI 也看不到，所以它不可能憑空編出別的東西。</Note>
      </Card>

      <Card title="每天的交易數字　（底色的那幾列代表當天有新聞）">
        <DataTable
          headers={[
            'id',
            '日期',
            '收盤',
            '漲跌%',
            '成交張',
            '量比五日均%',
            '外資',
            '投信',
            '自營',
            '相對月線%',
            '新聞',
          ]}
          rows={timeline}
        />
      </Card>

      <div className={styles.two}>
        <Card title="長期位置">
          <DataTable headers={anchorHeaders} rows={itemRows(packet.long_term_anchor)} />
        </Card>
        <Card title="基本面">
          <DataTable headers={anchorHeaders} rows={itemRows(packet.fundamental)} />
        </Card>
      </div>

      <Card>
        <RawJson label="展開完整原始資料（JSON）" value={packet} />
      </Card>
    </div>
  );
}
