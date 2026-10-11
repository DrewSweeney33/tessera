---
tessera: 1
id: powershell-essentials
title: PowerShell essentials
description: Finding commands, the object pipeline, filtering, errors, and remoting. Written in the Tessera Markdown format, with code blocks.
tags: [powershell, windows, admin]
---

## ps-find-commands
Q: Which cmdlet lists the commands available in your session, and can be narrowed with `-Noun` or `-Verb`?
Answer: Get-Command
Accept: gcm
Hint: Its alias is three letters.
Tags: discovery

## ps-help-examples
Q: Which `Get-Help` parameter shows only the examples for a cmdlet?
Answer: -Examples
Accept: Examples
Tags: discovery

## ps-verb-noun
Cloze: PowerShell cmdlets are named {{c1::Verb}}-{{c2::Noun}}, and the cmdlet {{c3::Get-Verb}} lists the approved verbs.
Tags: discovery

## ps-objects-not-text
Q: What does a PowerShell pipeline pass from one command to the next?
A: **Objects**, not text. The receiving command works with the properties and methods of each object, so there is usually no need to parse text.
Tags: pipeline

## ps-get-member
Q: Which cmdlet shows the properties and methods of the objects in a pipeline?
Answer: Get-Member
Accept: gm
Hint: Pipe a command into it.
Tags: pipeline, discovery

## ps-where-object
Q: What does this command return?

```powershell
Get-Service | Where-Object Status -eq 'Running'
```

A: Only the services whose `Status` property equals `Running`.
Source: about_Comparison_Operators
Tags: pipeline, filtering

## ps-select-sort
Q: Which command lists the five processes using the most CPU time?

```powershell
Get-Process | ??? CPU -Descending | ??? -First 5
```

A: Fill the gaps with `Sort-Object` and `Select-Object`:

```powershell
Get-Process | Sort-Object CPU -Descending | Select-Object -First 5
```

Tags: pipeline, filtering

## ps-current-object
Q: What is the longer name for `$_`, the current object inside a pipeline script block?
Answer: $PSItem
Accept: PSItem
Tags: pipeline

## ps-like-match
Cloze: Use {{c1::-like}} to compare with wildcards such as `*`, and {{c2::-match}} to compare with a regular expression.
Extra: Both are case-insensitive by default. Their case-sensitive forms start with `c`, for example `-clike` and `-cmatch`.
Tags: filtering

## ps-tail-follow
Q: Which `Get-Content` parameter keeps the command running and prints new lines as they are added, like `tail -f`?
Answer: -Wait
Accept: Wait
Hint: Combine it with `-Tail 20` to start from the last lines.
Tags: files

## ps-export
Q: How do you save the output of a command as JSON in a file?
A: Convert the objects, then write the text:

```powershell
Get-Service | ConvertTo-Json | Set-Content services.json
```

Tags: files

## ps-error-action
Cloze: A non-terminating error is only caught by `try` and `catch` when the command runs with {{c1::-ErrorAction Stop}}.
Extra: Set `$ErrorActionPreference = 'Stop'` to apply this to every command in the session.
Tags: errors

## ps-try-catch
Q: What does this script print when `C:\missing.txt` does not exist?

```powershell
try {
    Get-Content C:\missing.txt -ErrorAction Stop
}
catch {
    "Failed: $($_.Exception.Message)"
}
```

A: A line starting with `Failed:` followed by the error message. `-ErrorAction Stop` turns the error into one that `catch` can handle.
Tags: errors

## ps-execution-policy
Q: Which statement about the PowerShell execution policy is correct?
Choices:
- It is a security boundary that stops attackers running scripts
- [x] It helps prevent running scripts by accident, and can be bypassed
- It encrypts scripts on disk
- It limits which cmdlets a user may call
Explanation: Microsoft documents it as a safety feature, not a security boundary. A user can still run commands typed at a prompt, and can bypass the policy with a command line option.
Source: about_Execution_Policies
Tags: security

## ps-remote-run
Q: Which cmdlet runs a script block on one or more remote computers?
Answer: Invoke-Command
Accept: icm
Tags: remoting

## ps-remote-session
Q: Which cmdlet starts an interactive session on one remote computer?
Answer: Enter-PSSession
Tags: remoting
