// MDD 계산기 알림용 공개 시세 요약. 매 거래일 GitHub Actions 가 실행한다. 외부 의존성 없음.
// 자산마다 일별 수정종가 전체를 받아 역대 고점·최근 확정 종가·고점 대비 하락률만 공개한다.
import fs from 'node:fs'

const assets = JSON.parse(fs.readFileSync('mdd/feed/assets.json', 'utf8'))
const out = { v: 1, generatedAt: new Date().toISOString(), source: 'Yahoo Finance chart API (adjclose, daily)', assets: {} }
const failures = []
for (const { id, symbol } of assets) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (factory-mdd-feed)' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const r = (await res.json()).chart.result[0]
    const closes = r.indicators.adjclose?.[0]?.adjclose ?? r.indicators.quote[0].close
    const regular = r.meta.currentTradingPeriod?.regular
    let n = r.timestamp.length
    // 장중이면 마지막 행은 확정 종가가 아니므로 제외
    if (regular && r.timestamp[n - 1] >= regular.start && Date.now() / 1000 < regular.end) n -= 1
    let peak = 0, peakDate = null, last = null, lastDate = null
    for (let i = 0; i < n; i += 1) {
      const c = closes[i]
      if (typeof c !== 'number' || !(c > 0)) continue
      const date = new Date((r.timestamp[i] + (r.meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10)
      if (c >= peak) { peak = c; peakDate = date }
      last = c; lastDate = date
    }
    if (!last) throw new Error('no closes')
    const round = v => Number(v.toPrecision(6))
    const p = round(peak), l = round(last)
    out.assets[id] = { last: l, lastDate, peak: p, peakDate, dd: Number((l / p - 1).toFixed(6)) }
  } catch (e) {
    failures.push(`${id}: ${e.message}`)
  }
  await new Promise(r => setTimeout(r, 300))
}
if (Object.keys(out.assets).length < assets.length * 0.8) {
  console.error('too many failures', failures)
  process.exit(1) // 이전 파일을 유지한다
}
fs.writeFileSync('mdd/feed/latest.json', JSON.stringify(out) + '\n')
console.log(`ok ${Object.keys(out.assets).length}/${assets.length}`, failures)
