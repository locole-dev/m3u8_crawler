# Plan: M3U8 Extractor (Node.js + Playwright Stealth)

## Context
Thư mục `E:\me\m3u8_scraper` đang trống. Mục tiêu: xây dựng project Node.js (ES Modules) dùng Playwright + stealth để bóc tách link `.m3u8` kèm headers từ các site streaming bóng đá / sự kiện.

**Flow thực tế của site nguồn:**
1. Trang **listing**: hiển thị danh sách trận đấu / sự kiện (mỗi item là 1 link).
2. Click vào 1 trận → điều hướng sang **trang chi tiết** (có thể là tab mới, có thể cùng tab, có thể qua redirect).
3. Trang chi tiết thường nhúng player qua **iframe** (đôi khi nhiều iframe lồng nhau, đôi khi nhiều "server" để chọn — server1/server2…).
4. Player chỉ phát sinh request `.m3u8` **sau khi user click Play** (hoặc sau khi iframe load xong).

→ Tool phải xử lý được chuỗi điều hướng + nhiều server lựa chọn, không chỉ "mở 1 URL rồi đợi".

## Cấu trúc project
```
m3u8_scraper/
├─ package.json          # type: module
├─ .env.example          # PROXY, HEADLESS, TIMEOUT_MS, USER_AGENT
├─ src/
│  ├─ config.js          # đọc env, default viewport/UA/proxy
│  ├─ selectors.js       # selector "Play" + selector "server tab" phổ biến
│  └─ M3U8Extractor.js   # class chính
└─ index.js              # CLI demo
```

## Cài đặt
```
npm init -y
npm i playwright-extra puppeteer-extra-plugin-stealth dotenv
npx playwright install chromium
```
`package.json` thêm `"type": "module"`.

## API thiết kế lại theo flow listing → detail

```js
class M3U8Extractor {
  constructor(options = {})
  async init()
  async close()

  // Mở trang listing, trả về danh sách item {title, href}
  async listMatches(listingUrl, { itemSelector } = {})

  // Mở trang chi tiết 1 trận, click Play (và thử từng server nếu có),
  // bóc m3u8 + headers
  async extractFromMatch(matchUrl, { serverTabsSelector } = {})

  // Helper "all-in-one": listing → loop từng match → trả mảng kết quả
  async extractAll(listingUrl, { limit, itemSelector, serverTabsSelector })

  // Vẫn giữ extract(url) đơn lẻ cho trường hợp đã biết URL detail
  async extract(url)
}
```

### Trả về
```js
{
  matchUrl,
  title,
  streams: [
    { url: "....m3u8", headers: { referer, origin, "user-agent", cookie, ... }, frameUrl, server: "server1" }
  ]
}
```

## Core logic

### 1. Network listener (đăng ký mức **context**, không phải page)
- Đăng ký `context.on('request', ...)` 1 lần ngay sau khi tạo context. Lý do: trang detail có thể mở **tab/popup mới** khi click trận; listener mức context bắt được mọi page con.
- Filter regex `/\.m3u8(\?|$)/i`. Lưu `{url, headers: req.headers(), frameUrl: req.frame()?.url(), pageUrl: req.frame()?.page()?.url()}`.

### 2. `listMatches(listingUrl, opts)`
- `goto` listing.
- Auto-detect items nếu không có selector: `a[href*="match"], a[href*="live"], a[href*="watch"], .match-item a, .event-item a, li a`.
- Trả về `[{title: textContent.trim(), href: absolute URL}]`, đã khử trùng lặp theo href.

### 3. `extractFromMatch(matchUrl, opts)`
- Tạo `page` mới (listener đã đặt ở context).
- Track popup: `context.on('page', popup => ...)` — nếu site mở tab mới, dùng popup làm page chính.
- `goto(matchUrl, {waitUntil:'domcontentloaded'})`.
- **Phát hiện danh sách "server"**: thử selector `.server-item, .server-list a, [class*="server"] button, .nav-tabs a, .tab-server li`. Nếu có ≥2 → loop từng server:
  - Click server → đợi iframe reload (`waitForLoadState('networkidle', 5s)`).
  - Chạy `clickPlayRecursive(page.mainFrame())`.
  - Đợi tối đa N giây cho request m3u8; thu được thì gắn `server: <label>`.
- Nếu không có server tab → click Play 1 lần.
- Sau khi bắt được link đầu, đợi thêm 3s để gom variant playlists.

### 4. `clickPlayRecursive(frame)` (xử lý iframe lồng nhau)
- Selector trong `selectors.js`:
  ```js
  export const PLAY_SELECTORS = [
    '.vjs-big-play-button',
    'button[aria-label="Play"]',
    'button[aria-label*="play" i]',
    '.jw-icon-display',
    '.plyr__control--overlaid',
    '.ytp-large-play-button',
    '.play-button',
    '[class*="play" i][class*="btn" i]',
    'video'
  ];
  export const SERVER_SELECTORS = [
    '.server-item', '.server-list a', '[class*="server"] button',
    '.nav-tabs a', '.tab-server li', '[data-server]'
  ];
  ```
- Với mỗi selector: `frame.locator(sel).first()`, kiểm tra `isVisible()` (timeout 500ms) → `click({timeout:1500})`. Bọc try/catch.
- Đệ quy `frame.childFrames()`.
- Nếu lần 1 không click được, chờ `networkidle` rồi thử lại 1 lần.

### 5. `extractAll(listingUrl, {limit=10})`
- `listMatches` → cắt theo `limit` → loop `extractFromMatch` tuần tự (tránh ban IP).
- Random delay 1-3s giữa các trận.

### Resilience
- Mỗi `extractFromMatch` bọc try/finally → `page.close()` cuối hàm.
- Timeout tổng thể bằng `Promise.race([gotResult, sleep(timeout)])`.
- Bắt lỗi navigation; trả về `streams: []` nếu fail thay vì throw cả batch.
- `close()` đóng context + browser.

### Stealth
```js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());
```
Launch với `args: ['--disable-blink-features=AutomationControlled']`, `ignoreDefaultArgs:['--enable-automation']`.

## `index.js` (demo)
- Cú pháp: `node index.js list <listingUrl> [limit]` hoặc `node index.js match <matchUrl>`.
- In JSON kết quả + lệnh ffmpeg gợi ý:
  `ffmpeg -headers "Referer: ...\r\nUser-Agent: ..." -i <m3u8> -c copy out.mp4`.

## Cloudflare mạnh — hướng xử lý
- Stealth plugin vượt được phần lớn JS challenge cơ bản.
- CF Turnstile/Interactive: dùng `headless:false` + `launchPersistentContext(userDataDir)` để giữ `cf_clearance` qua nhiều lần chạy.
- Residential proxy cùng quốc gia với site (IP datacenter dễ bị block).
- Hành vi giống người: random delay, mousemove, scroll trước khi click.
- Backup: tích hợp 2Captcha/CapSolver hoặc FlareSolverr (proxy giải CF) → lấy cookie rồi inject vào Playwright context.
- Giữ UA + `sec-ch-ua` + `Accept-Language` đồng bộ với fingerprint stealth giả lập.

## Critical files to create
- `E:\me\m3u8_scraper\package.json`
- `E:\me\m3u8_scraper\.env.example`
- `E:\me\m3u8_scraper\src\config.js`
- `E:\me\m3u8_scraper\src\selectors.js`
- `E:\me\m3u8_scraper\src\M3U8Extractor.js`
- `E:\me\m3u8_scraper\index.js`

## Verification
1. `npm i && npx playwright install chromium`.
2. `node index.js list "<listingUrl>" 3` → in ra 3 trận, mỗi trận có ≥1 m3u8.
3. `node index.js match "<matchUrl>"` → in m3u8 + headers cho từng server.
4. Verify bằng ffmpeg với headers thu được — không bị 403.
5. Edge: trang không có m3u8 (timeout) → trả `streams: []`, không crash; trang nhiều iframe lồng → vẫn click được Play.
