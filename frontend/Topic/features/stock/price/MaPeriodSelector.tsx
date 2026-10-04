import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const PRESETS = ['5', '10', '20', '60'] as const;

/** 移動平均週期（決議 D9-c10）；至少保留一個，值以逗號串接送給 candlestick-ma */
export function MaPeriodSelector({ value, onChange, disabled }: { value: string; onChange: (maPeriods: string) => void; disabled?: boolean }) {
  const selected = value.split(',').map((s) => s.trim()).filter((s) => (PRESETS as readonly string[]).includes(s));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground" id="ma-period-label">
        MA 週期
      </span>
      <ToggleGroup
        type="multiple"
        aria-labelledby="ma-period-label"
        value={selected}
        disabled={disabled}
        onValueChange={(next) => {
          if (!next.length) return;
          onChange([...next].sort((a, b) => Number(a) - Number(b)).join(','));
        }}
        variant="square"
        spacing={1.5}
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem
            key={p}
            value={p}
            aria-label={`MA${p}`}
            className="min-w-12 font-mono text-xs tabular-nums"
          >
            MA{p}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
