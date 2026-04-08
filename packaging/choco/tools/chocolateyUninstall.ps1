$ErrorActionPreference = 'Stop'

$uninstallArgs = @{
  packageName    = 'watchtower'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

$key = Get-UninstallRegistryKey -SoftwareName 'Watchtower*'
if ($key) {
  $uninstallArgs['file'] = "$($key.UninstallString)".Split('"')[1]
  Uninstall-ChocolateyPackage @uninstallArgs
}
