// MDD 계산기 알림용 공개 시세 요약. 매 거래일 GitHub Actions 가 실행한다. 외부 의존성 없음.
// 자산마다 일별 수정종가 전체를 받아 역대 고점·최근 확정 종가·고점 대비 하락률을 latest.json 에 공개한다.
// recent.json 에는 최근 RECENT_DAYS 일의 일별 확정 종가를 앱 번들 데이터와 같은 압축 형식(start·gap·px)으로 공개한다.
// 앱은 실행 시 recent.json 을 받아 번들 데이터 뒤에 덧붙인다(앱을 다시 빌드하지 않아도 차트·MDD 가 최신).
import fs from 'node:fs'

const RECENT_DAYS = 400
const DAY_MS = 86_400_000
const recentFrom = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10)
const toDay = d => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
// 알림 피드(latest.json)에는 넣지 않고 recent.json 에만 넣는 자산(포트폴리오 원화 환산용 환율)
const RECENT_ONLY = [{ id: 'usdkrw', symbol: 'KRW=X' }]

const assets = JSON.parse(fs.readFileSync('mdd/feed/assets.json', 'utf8'))
const out = { v: 1, generatedAt: new Date().toISOString(), source: 'Yahoo Finance chart API (adjclose, daily)', assets: {} }
const recent = { v: 1, generatedAt: out.generatedAt, source: out.source, assets: {} }
const failures = []
for (const { id, symbol, recentOnly } of [...assets, ...RECENT_ONLY.map(a => ({ ...a, recentOnly: true }))]) {
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
    const rows = new Map()
    for (let i = 0; i < n; i += 1) {
      const c = closes[i]
      if (typeof c !== 'number' || !(c > 0)) continue
      const date = new Date((r.timestamp[i] + (r.meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10)
      if (c >= peak) { peak = c; peakDate = date }
      last = c; lastDate = date
      if (date >= recentFrom) rows.set(date, c) // 같은 날짜가 두 번이면 마지막 값
    }
    if (!last) throw new Error('no closes')
    const round = v => Number(v.toPrecision(6))
    const dates = [...rows.keys()].sort()
    if (dates.length >= 2) {
      const days = dates.map(toDay)
      recent.assets[id] = { start: dates[0], gap: days.map((d, i) => (i ? d - days[i - 1] : 0)), px: dates.map(d => round(rows.get(d))) }
    }
    if (recentOnly) continue
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
if (Object.keys(recent.assets).length >= assets.length * 0.8) fs.writeFileSync('mdd/feed/recent.json', JSON.stringify(recent) + '\n')
console.log(`ok ${Object.keys(out.assets).length}/${assets.length}`, failures)
