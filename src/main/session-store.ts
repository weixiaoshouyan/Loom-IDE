/**
 * 会话持久化（磁盘版）——替代 localStorage 存全部打开文件。
 *
 * 动机：localStorage 约 5MB 配额，多个中型文件即可写满并静默失败；且 >50KB
 * 文件被截断后无法保存（数据安全隐患）。改为主进程磁盘存储：
 *   - 原子写（tmp + rename），崩溃不损坏；
 *   - 无配额限制，大文件内容完整保存；
 *   - 仍保留截断护栏（见 renderer/app-storage.ts 的 contentTruncated），
 *     但磁盘版容量足够，截断几乎不会触发。
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export function sessionFilePath(): string {
  return path.join(app.getPath('userData'), 'sessions', 'session.json');
}

export function saveSessionData(data: unknown): boolean {
  try {
    const file = sessionFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function loadSessionData(): unknown | null {
  try {
    const file = sessionFilePath();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}
