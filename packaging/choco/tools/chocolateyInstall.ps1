$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'watchtower'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Nytuo/watchtower/releases/download/v0.1.0/Watchtower_0.1.0_x64-setup.exe'
  checksum64     = 'cc26f75fdbc300f6e6269639acd92ecfec95017ba9accd3d884c58f01ca8bbcb'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
