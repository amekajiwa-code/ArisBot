param(
  [string]$IconPath,
  [string]$LogPath,
  [string]$MsgPath,
  [string]$Autostart = 'off',
  [int]$ParentPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# PNG → 32x32 아이콘(트레이 렌더링 선명도 위해 리사이즈). 실패 시 기본 아이콘.
function New-TrayIcon([string]$path) {
  try {
    $src = [System.Drawing.Bitmap]::FromFile($path)
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, 32, 32)
    $g.Dispose(); $src.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  } catch {
    return [System.Drawing.SystemIcons]::Application
  }
}

function Send-Cmd([string]$c) { [Console]::Out.WriteLine($c); [Console]::Out.Flush() }

$script:notify = New-Object System.Windows.Forms.NotifyIcon
$script:notify.Icon = New-TrayIcon $IconPath
$script:notify.Text = 'ArisBot'
$script:notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miRestart = $menu.Items.Add('봇 재시작')
$miRestart.add_Click({ Send-Cmd 'restart' })

$miLog = $menu.Items.Add('로그 보기')
$miLog.add_Click({ try { Start-Process -FilePath $LogPath } catch {} })

$script:miAuto = New-Object System.Windows.Forms.ToolStripMenuItem
$script:miAuto.Text = '자동시작'
$script:miAuto.CheckOnClick = $true
$script:miAuto.Checked = ($Autostart -eq 'on')
$script:miAuto.add_Click({
  if ($script:miAuto.Checked) { Send-Cmd 'autostart-on' } else { Send-Cmd 'autostart-off' }
})
[void]$menu.Items.Add($script:miAuto)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miQuit = $menu.Items.Add('종료')
$miQuit.add_Click({
  Send-Cmd 'quit'
  $script:notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$script:notify.ContextMenuStrip = $menu

# 타이머: 부모 생존 확인 + 컨트롤러→트레이 메시지(풍선) 폴링
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.add_Tick({
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    $script:notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
    return
  }
  if (Test-Path -LiteralPath $MsgPath) {
    try {
      $lines = Get-Content -LiteralPath $MsgPath -ErrorAction Stop
      Remove-Item -LiteralPath $MsgPath -Force -ErrorAction SilentlyContinue
      foreach ($ln in $lines) {
        if ($ln -like 'balloon:*') {
          $script:notify.BalloonTipTitle = 'ArisBot'
          $script:notify.BalloonTipText = $ln.Substring(8)
          $script:notify.ShowBalloonTip(5000)
        }
      }
    } catch {}
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

$script:notify.Visible = $false
$script:notify.Dispose()
