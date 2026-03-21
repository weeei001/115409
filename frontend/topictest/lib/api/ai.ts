/**
 * AI 問答 Mock API
 * 之後可替換為實際 API 呼叫
 */
export async function mockAiResponse(userMessage: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 400));

  const msg = userMessage.trim().toLowerCase();

  // 台積電相關
  if (msg.includes('2330') || msg.includes('台積電') || msg.includes('tsmc')) {
    return '台積電（2330）為全球晶圓代工龍頭，受惠於 AI 晶片需求強勁，先進製程產能滿載。建議可關注法說會展望與外資動向，長期投資者可考慮分批布局，短期需留意技術面支撐位。';
  }

  // 買進相關
  if (msg.includes('買進') || msg.includes('買入') || msg.includes('可以買')) {
    return '投資前建議先確認：1) 您的風險承受度 2) 投資期間（短線或長線）3) 該標的的基本面與技術面。可善用本平台的個股分析與多股比較功能，再做決策。';
  }

  // 賣出相關
  if (msg.includes('賣出') || msg.includes('賣掉') || msg.includes('該賣')) {
    return '賣出時機可參考：技術面跌破重要支撐、基本面惡化、或達到預設獲利目標。建議設定停損停利點，避免情緒化交易。';
  }

  // 風險相關
  if (msg.includes('風險') || msg.includes('危險') || msg.includes('安全')) {
    return '投資必有風險，建議：分散持股、不投入無法承受損失的資金、定期檢視投資組合。本平台提供的 AI 趨勢分析僅供參考，不構成投資建議。';
  }

  // 比較相關
  if (msg.includes('比較') || msg.includes('哪個好') || msg.includes('推薦')) {
    return '可使用「多股比較」功能，同時檢視多檔股票的走勢與表現。建議從產業龍頭、營收成長性、本益比等面向綜合評估。';
  }

  // 新聞相關
  if (msg.includes('新聞') || msg.includes('消息') || msg.includes('利多')) {
    return '財經新聞可作為參考，但需留意消息來源與時效性。重大訊息（如法說、財報）通常會影響股價，建議搭配技術分析一併考量。';
  }

  // 預設回覆
  return '您好！我是 AI 投資顧問，可以協助您了解股票分析、投資策略、風險控管等問題。您可以試著問我：某檔股票的看法、買進賣出時機、或投資風險建議。';
}
