/**
 * Renders docs/images/banner.png using a headless-ish Electron window so we get
 * real system font rendering without any image libraries.
 *
 * Run:  ./node_modules/.bin/electron scripts/make-banner.cjs
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const W = 1280
const H = 400

const icon = readFileSync(join(__dirname, '..', 'build', 'icon.png')).toString('base64')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{
    display:flex;align-items:center;gap:46px;padding:0 78px;
    font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;
    color:#e8ecf4;
    background:
      radial-gradient(900px 420px at 10% -14%, rgba(91,140,255,.30), transparent 62%),
      radial-gradient(760px 360px at 96% 116%, rgba(56,189,248,.20), transparent 62%),
      #0b0d12;
    box-sizing:border-box;
  }
  img{width:156px;height:156px;flex:none;filter:drop-shadow(0 20px 44px rgba(0,0,0,.6))}
  h1{font-size:88px;margin:0;letter-spacing:-2px;font-weight:700;line-height:1}
  .tag{font-size:24px;color:#8b95ab;margin-top:10px;letter-spacing:.2px}
  .feat{margin-top:24px;display:flex;gap:10px;flex-wrap:wrap}
  .pill{font-size:14px;color:#9ec1ff;border:1px solid rgba(91,140,255,.35);
        background:rgba(91,140,255,.10);padding:6px 13px;border-radius:999px}
</style></head>
<body>
  <img src="data:image/png;base64,${icon}">
  <div>
    <h1>Vigil</h1>
    <div class="tag">SSH tunnels that never sleep.</div>
    <div class="feat">
      <span class="pill">sleep / wake auto-reconnect</span>
      <span class="pill">jump-host topology</span>
      <span class="pill">macOS menu bar</span>
      <span class="pill">no &#96;ssh_config&#96; duplication</span>
    </div>
  </div>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    webPreferences: { offscreen: false }
  })
  win.setContentSize(W, H)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 700))
  const img = await win.webContents.capturePage()
  mkdirSync(join(__dirname, '..', 'docs', 'images'), { recursive: true })
  writeFileSync(join(__dirname, '..', 'docs', 'images', 'banner.png'), img.toPNG())
  console.log('wrote docs/images/banner.png')
  app.quit()
})
