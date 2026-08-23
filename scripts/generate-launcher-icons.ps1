Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$src = "C:\Users\user\.cursor\projects\c-Users-user-OneDrive-Documents-team-connect-heb\assets\c__Users_user_AppData_Roaming_Cursor_User_workspaceStorage_b033716ad6dc0238b7be6998f326b2f1_images_11111-50b6e43a-050d-4cc7-bb96-c6d79b6c8b3a.jpg"
$repo = "C:\Users\user\OneDrive\Documents\team-connect-heb"
$res = Join-Path $repo "android\app\src\main\res"
$icons = Join-Path $repo "public\icons"

Copy-Item -Force $src (Join-Path $icons "app-icon-source.jpg")

$img = [System.Drawing.Image]::FromFile($src)
$side = [Math]::Min($img.Width, $img.Height)
# Keep the figurines; drop most of the large pencil on the right.
$x = [int](($img.Width - $side) * 0.28)
$y = [int](($img.Height - $side) / 2)

$square = New-Object System.Drawing.Bitmap $side, $side
$sg = [System.Drawing.Graphics]::FromImage($square)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$sg.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $side, $side), $x, $y, $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
$sg.Dispose()
$img.Dispose()

function Save-Square([System.Drawing.Bitmap]$srcBmp, [int]$size, [string]$path, [bool]$round) {
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  if ($round) {
    $pathClip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pathClip.AddEllipse(0, 0, $size, $size)
    $g.SetClip($pathClip)
  }
  $g.DrawImage($srcBmp, 0, 0, $size, $size)
  $g.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}

$densities = @{
  "mipmap-mdpi"    = @{ launcher = 48;  foreground = 108 }
  "mipmap-hdpi"    = @{ launcher = 72;  foreground = 162 }
  "mipmap-xhdpi"   = @{ launcher = 96;  foreground = 216 }
  "mipmap-xxhdpi"  = @{ launcher = 144; foreground = 324 }
  "mipmap-xxxhdpi" = @{ launcher = 192; foreground = 432 }
}

foreach ($folder in $densities.Keys) {
  $dir = Join-Path $res $folder
  $l = $densities[$folder].launcher
  $f = $densities[$folder].foreground
  Save-Square $square $l (Join-Path $dir "ic_launcher.png") $false
  Save-Square $square $l (Join-Path $dir "ic_launcher_round.png") $true
  Save-Square $square $f (Join-Path $dir "ic_launcher_foreground.png") $false
}

Save-Square $square 192 (Join-Path $icons "icon-192.png") $false
Save-Square $square 512 (Join-Path $icons "icon-512.png") $false
Save-Square $square 512 (Join-Path $icons "launcher-preview.png") $false

$square.Dispose()
Write-Output "OK crop x=$x y=$y side=$side"
