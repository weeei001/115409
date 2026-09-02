#Requires -RunAsAdministrator
$ErrorActionPreference = 'Continue'
foreach ($n in 'stock-backend','stock-rag','stock-frontend','stock-scheduler') {
    nssm stop $n confirm
    nssm remove $n confirm
}
Get-Service stock-* -ErrorAction SilentlyContinue
