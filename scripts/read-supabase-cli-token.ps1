Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credPtr);
  [DllImport("advapi32", SetLastError=true)] public static extern bool CredFree(IntPtr cred);
  public const int CRED_TYPE_GENERIC = 1;
  public static byte[] ReadBytes(string target) {
    IntPtr pc; if (!CredRead(target, CRED_TYPE_GENERIC, 0, out pc)) return null;
    var c = Marshal.PtrToStructure<CREDENTIAL>(pc);
    var bytes = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
    CredFree(pc);
    return bytes;
  }
}
"@

$bytes = [CredMan]::ReadBytes("Supabase CLI:supabase")
if (-not $bytes) { Write-Output "NO_BYTES"; exit 1 }

$unicode = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
$utf8 = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)

function Pick-Token([string]$s) {
  if ($s -match '"access_token"\s*:\s*"([^"]+)"') { return $matches[1] }
  if ($s -match '^sbp_[A-Za-z0-9]+$') { return $s }
  return $null
}

$token = Pick-Token $unicode
if (-not $token) { $token = Pick-Token $utf8 }
if (-not $token) {
  Write-Output "RAW_UNICODE_LEN=$($unicode.Length)"
  Write-Output "RAW_UTF8_LEN=$($utf8.Length)"
  exit 2
}
Write-Output $token
