import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { AITrendAnalysis } from '../lib/types';

interface Props {
  analysis: AITrendAnalysis;
}

type SentimentTone = 'up' | 'down' | 'neutral';

interface ParsedSummary {
  sentiment?: string;
  conclusion?: string;
  risk?: string;
}

function stripEmoji(value: string | undefined): string | undefined {
  if (!value) return value;
  // Strip emoji-presentation chars (📉) and text-default chars forced to emoji via VS16 (⚠️),
  // while preserving plain-text arrow symbols like → ↗ ↘ that the backend may use in copy.
  return value
    .replace(/\p{Emoji_Presentation}️?|\p{Extended_Pictographic}️/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRagSummary(raw: string): ParsedSummary {
  const sentiment = raw
    .match(/市場情緒[：:]\s*([^。\n一風]+?)(?=\s*(?:一句話結論|風險提醒|$))/)?.[1]
    ?.trim();
  const conclusion = raw
    .match(/一句話結論[：:]\s*([\s\S]+?)(?=\s*風險提醒|$)/)?.[1]
    ?.trim();
  const risk = raw.match(/風險提醒[：:]\s*([\s\S]+?)$/)?.[1]?.trim();
  return {
    sentiment: stripEmoji(sentiment),
    conclusion: stripEmoji(conclusion),
    risk: stripEmoji(risk),
  };
}

function toneFromSentiment(s?: string): SentimentTone {
  if (!s) return 'neutral';
  if (/看漲|偏多|轉多|走強|轉強|多方/.test(s)) return 'up';
  if (/看跌|偏空|轉空|走弱|轉弱|空方/.test(s)) return 'down';
  return 'neutral';
}

const TONE_BADGE: Record<SentimentTone, string> = {
  up: 'bg-up-muted text-up-emphasis border-up/20',
  down: 'bg-down-muted text-down-emphasis border-down/20',
  neutral:
    'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border-[var(--color-border)]',
};

const TONE_ICON: Record<SentimentTone, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

export const AITrendPanel: React.FC<Props> = ({ analysis }) => {
  const raw = analysis.summary?.trim() ?? '';
  const parsed = useMemo(() => parseRagSummary(raw), [raw]);

  if (!raw) return null;

  const tone = toneFromSentiment(parsed.sentiment);
  const ToneIcon = TONE_ICON[tone];
  const hasStructured = Boolean(parsed.sentiment || parsed.conclusion || parsed.risk);

  return (
    <motion.section
      aria-label="市場情緒解讀"
      className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:p-6 shadow-[var(--shadow-card)]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ background: 'var(--brand-gradient)' }}
      />
      <div className="pl-2 sm:pl-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand uppercase tracking-wider">
          <Sparkles size={14} aria-hidden />
          市場情緒解讀
        </div>

        {hasStructured ? (
          <div className="mt-3 space-y-4">
            {parsed.sentiment ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">市場情緒</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${TONE_BADGE[tone]}`}
                >
                  <ToneIcon size={14} aria-hidden />
                  {parsed.sentiment}
                </span>
              </div>
            ) : null}

            {parsed.conclusion ? (
              <p className="text-sm sm:text-base leading-7 text-[var(--color-text-primary)]">
                {parsed.conclusion}
              </p>
            ) : null}

            {parsed.risk ? (
              <div
                role="note"
                aria-label="風險提醒"
                className="ui-alert-warning flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed"
              >
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0 text-warning-icon"
                  aria-hidden
                />
                <p className="flex-1">
                  <span className="font-semibold mr-1">風險提醒</span>
                  {parsed.risk}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm sm:text-base leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap">
            {raw}
          </p>
        )}
      </div>
    </motion.section>
  );
};
