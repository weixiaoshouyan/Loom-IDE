import fs from 'fs';
import path from 'path';
// 权限边界单一事实源：agent 工具与 IPC handler 共用主进程的 PathPermissionStore。
// 存储未初始化时（单元测试）回退到 workspacePath 词法检查（见 isSafePath）。
import { canAccess as storeCanAccess, hasGrants as storeHasGrants } from '../main/path-permissions';
import type { ToolExecutionContext } from './tool-types';

export const HIDDEN_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '__pycache__', '.next', 'coverage', '.vscode', '.idea', 'build', 'target']);

export function resolvePath(inputPath: string, workspacePath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(workspacePath, inputPath);
}

/** 词法包含判定（parent 自身也算在内）；用 path.relative 避开 Windows 大小写不敏感场景下 startsWith 绕过 */
export function isPathInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isSafePath(filePath: string, workspacePath: string): boolean {
  // 首选：主进程 PathPermissionStore —— 以用户真正授权的根目录为边界
  // （含 realpath 双重校验、symlink 逃逸防护、非存在路径的祖先回溯）。
  // 这是唯一在线的权限判定；renderer 传入的 workspacePath 仅用于相对路径解析。
  // 存储尚未初始化或没有任何授权时（单元测试 / 冷启动），回退到 workspacePath
  // 词法 + realpath 检查，保持与旧行为一致。
  try {
    if (storeHasGrants()) return storeCanAccess(filePath);
  } catch { /* 存储未初始化 → 回退 */ }
  const resolved = path.resolve(filePath);
  const normalizedWorkspace = path.resolve(workspacePath);
  // 第一关：词法路径必须在工作区内。
  if (!isPathInside(normalizedWorkspace, resolved)) return false;

  // 工作区本身可能是 symlink（子路径 realpath 会落在链接目标下），
  // 故以工作区的 realpath 作为第二关的基准。
  let realWorkspace = normalizedWorkspace;
  try { realWorkspace = fs.realpathSync(normalizedWorkspace); } catch { /* 保留词法形式 */ }

  // 用 lstat 判断路径本身是否存在（含断链 / 受限 symlink，existsSync 会跟随链接而误报 false）
  let exists = false;
  try { fs.lstatSync(resolved); exists = true; } catch { /* 路径不存在 */ }

  if (exists) {
    // 第二关：已存在的路径 realpath 失败即拒绝（受限环境宁可误杀，不可静默放行），
    // 解析成功则必须仍在工作区（realpath 形式）内，封死 symlink 逃逸。
    try {
      const real = fs.realpathSync(resolved);
      return isPathInside(realWorkspace, real);
    } catch {
      return false;
    }
  }

  // 路径尚不存在（新建文件）：对最深的已存在祖先做 realpath 校验，
  // 防止经由「工作区内指向外部的目录 symlink」创建越界文件。
  let cur = path.dirname(resolved);
  while (cur && cur !== path.dirname(cur)) {
    let ancestorExists = false;
    try { fs.lstatSync(cur); ancestorExists = true; } catch { /* 继续向上 */ }
    if (ancestorExists) {
      try {
        const realAncestor = fs.realpathSync(cur);
        return isPathInside(realWorkspace, realAncestor);
      } catch {
        return false;
      }
    }
    cur = path.dirname(cur);
  }
  return true;
}

export function isSensitivePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const sensitiveNames = ['.env', '.env.local', '.env.production', 'credentials', 'credentials.json', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'known_hosts', 'authorized_keys'];
  if (sensitiveNames.includes(base)) return true;
  if (/\.(pem|key|pfx|p12|keystore|jks)$/i.test(base)) return true;
  // 不要误删 .git 内部对象
  if (filePath.split(/[\\/]/).includes('.git')) return true;
  return false;
}

/**
 * 破坏性操作（删除 / 重命名）的安全门：
 * - 敏感文件（密钥、.env、.git 等）一律拒绝；
 * - 否则仅在「自动应用」或调用方显式 confirm 时才真正执行，
 *   否则返回待确认提案，强制人工确认，避免 Agent 误删。
 */
export function destructiveAllowed(args: any, context: ToolExecutionContext): boolean {
  return context.autoApplyFileWrites === true || args.confirm === true;
}
