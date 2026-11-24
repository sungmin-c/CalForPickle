//! Start with Windows through a logon task instead of the Run key. Run entries start one after another in Explorer's
//! queue; a logon task does not wait in that queue. The task has no 72 h limit (the schtasks default), so the app keeps running.

use std::os::windows::process::CommandExt;
use std::process::Command;

const TASK: &str = "CalForPickle";
const RUN_KEY: &str = r"HKCU:\Software\Microsoft\Windows\CurrentVersion\Run";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs a PowerShell snippet. The exe path goes in via env, never spliced into the script text.
fn ps(script: &str, exe: &str) -> Result<String, String> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("CFP_EXE", exe)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn autostart_enabled() -> Result<bool, String> {
    let script = format!("if (Get-ScheduledTask -TaskName '{TASK}' -ErrorAction SilentlyContinue) {{ 'yes' }} else {{ 'no' }}");
    Ok(ps(&script, "")? == "yes")
}

#[tauri::command]
pub fn autostart_set(on: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy();
    // Removing the old Run value makes the switch complete: otherwise the app would start twice at logon.
    let script = if on {
        format!(
            "$u = \"$env:USERDOMAIN\\$env:USERNAME\"; \
             $a = New-ScheduledTaskAction -Execute $env:CFP_EXE; \
             $t = New-ScheduledTaskTrigger -AtLogOn -User $u; \
             $p = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited; \
             $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero); \
             Register-ScheduledTask -TaskName '{TASK}' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null; \
             Remove-ItemProperty -Path '{RUN_KEY}' -Name '{TASK}' -ErrorAction SilentlyContinue"
        )
    } else {
        format!(
            "Unregister-ScheduledTask -TaskName '{TASK}' -Confirm:$false -ErrorAction SilentlyContinue; \
             Remove-ItemProperty -Path '{RUN_KEY}' -Name '{TASK}' -ErrorAction SilentlyContinue"
        )
    };
    ps(&script, &exe).map(|_| ())
}
