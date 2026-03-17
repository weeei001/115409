import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, ExternalLink, Tag, ChevronDown } from 'lucide-react';
import type { News } from '../lib/types';

interface Props {
  news: News;
  index?: number;
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseStocks(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\.TW$/i, ''))
    .filter(Boolean);
}

function truncateContent(content: string | null, maxLen = 120): string {
  if (!content) return '';
  const plain = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
}

export const NewsCard: React.FC<Props> = ({ news, index = 0 }) => {
  const [expanded, setExpanded] = useState(false);
  const stocks = parseStocks(news.related_stocks);
  const hasContent = !!news.content?.trim();
  const snippet = truncateContent(news.content);

  return (
    <motion.article
      className="group border-b border-gray-100 last:border-b-0 py-4 first:pt-0"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {stocks.length > 0 && stocks.slice(0, 3).map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-0.5 text-[11px] font-mono font-medium
                           text-[#ffa95a] bg-[#fff9e6] px-1.5 py-0.5 rounded"
              >
                <Tag size={9} />
                {s}
              </span>
            ))}
            {news.publish_time && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                <Clock size={10} />
                {formatTime(news.publish_time)}
              </span>
            )}
          </div>

          <h3 className="text-sm font-semibold text-gray-800 leading-snug mb-1
                         group-hover:text-[#ffa95a] transition-colors line-clamp-2">
            {news.url ? (
              <a href={news.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {news.title}
              </a>
            ) : (
              news.title
            )}
          </h3>

          {snippet && !expanded && (
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{snippet}</p>
          )}

          <AnimatePresence>
            {expanded && hasContent && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <p className="text-xs text-gray-600 leading-relaxed mt-1 whitespace-pre-line">
                  {news.content?.replace(/<[^>]*>/g, '').trim()}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
          {hasContent && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          {news.url && (
            <a
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-[#ffa95a]"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </motion.article>
  );
};
