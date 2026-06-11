Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""E:\工作\SDA配置\loom"" && npx electron .", 0, False
