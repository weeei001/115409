import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, TrendingUp } from 'lucide-react';
import { AITrendAnalysis } from '../lib/types';
import styles from '../styles/components/AITrendPanel.module.scss';

interface Props {
  analysis: AITrendAnalysis;
}

export const AITrendPanel: React.FC<Props> = ({ analysis }) => {
  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className={styles.conclusionWrap}>
        <span className={styles.label}>AI 趨勢推測</span>
        <h1 className={styles.conclusion}>{analysis.conclusion}</h1>
        
        <div className={styles.confidence}>
          <TrendingUp size={16} color="#ffa95a" />
          <span className={styles.text}>信心指數 {analysis.confidence}%</span>
          <div className={styles.bar}>
            <motion.div
              className={styles.fill}
              initial={{ width: 0 }}
              animate={{ width: `${analysis.confidence}%` }}
              transition={{ duration: 1, delay: 0.3 }}
            />
          </div>
        </div>
      </div>

      <p className={styles.summary}>{analysis.summary}</p>

      <div className={styles.sourcesWrap}>
        <div className={styles.sourcesTitle}>
          <BookOpen />
          <span>RAG 引用來源</span>
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
