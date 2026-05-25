import React from 'react';
import { motion } from 'motion/react';
import { BookOpen } from 'lucide-react';
import type { AITrendAnalysis } from '../lib/types';
import styles from '../styles/components/AITrendPanel.module.scss';

interface Props {
  analysis: AITrendAnalysis;
  /** 引用區塊標題；示範資料時建議傳「示範引用來源」避免與即時 RAG 混淆 */
  sourcesSectionTitle?: string;
}

export const AITrendPanel: React.FC<Props> = ({ analysis, sourcesSectionTitle = 'RAG 引用來源' }) => {
  const conclusionLength = analysis.conclusion?.length ?? 0;
  const conclusionSizeClass =
    conclusionLength > 120
      ? styles.conclusionXs
      : conclusionLength > 70
        ? styles.conclusionSm
        : conclusionLength > 30
          ? styles.conclusionMd
          : styles.conclusionLg;

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className={styles.conclusionWrap}>
        <span className={styles.label}>AI 趨勢推測</span>
        <h2 className={`${styles.conclusion} ${conclusionSizeClass}`}>{analysis.conclusion}</h2>
      </div>

      <p className={styles.summary}>{analysis.summary}</p>

      <div className={styles.sourcesWrap}>
        <div className={styles.sourcesTitle}>
          <BookOpen />
          <span>{sourcesSectionTitle}</span>
        </div>
        <div className={styles.sourceList}>
          {analysis.sources.map((source, index) => (
            <motion.div
              key={source.id}
              className={styles.sourceCard}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
            >
              <div className={styles.sourceDate}>{source.date}</div>
              <div className={styles.sourceTitle}>{source.title}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
