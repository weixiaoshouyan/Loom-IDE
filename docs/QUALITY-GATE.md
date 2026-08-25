# Loom IDE — 质量门禁基线 (Quality Gate Baseline)

> 由 Senior Developer 建立 · 2026-07-22 · 最近校准：2026-08-10（覆盖率阈值对齐真实数据）
> 路线：立质量门禁基线（团队技术提升第一步）

## 一、已交付

### 1. TypeScript 类型硬化
- 两个 tsconfig 早已 `strict: true`（原先即开，非本任务新增）。
- 新增 `noImplicitOverride` + `noFallthroughCasesInSwitch`（近零噪声、高价值）。
- 修复 `src/renderer/components/ErrorBoundary.tsx` 两处缺失 `override`（生命周期方法覆盖 `React.Component`），消除 TS4114。
- 结果：**`tsc -p config/tsconfig.json --noEmit` 与 `tsc -p config/tsconfig.main.json --noEmit` 均 0 错误，全绿。**
- `noUncheckedIndexedAccess` 经实测产生 94 处错误（索引返回 `T | undefined` 的下游传播），**留作 Phase 2 分阶段拧紧**，避免首日全红导致门禁被关。

### 2. ESLint 覆盖扩展 + `any` 渐进式门禁 (ratchet)
- `eslint.config.mjs`：将 `src/renderer/**/*.{ts,tsx}` 纳入 lint 范围（用现有 `typescript-eslint` 类型感知规则：捕获 `any`、未用变量、不安全断言等）。
- `no-explicit-any` 仓库级 = **`warn`**（当前约 650 处，提供可下降的指标，CI 保持绿色）。
- `eslint.config.staged.mjs` + `lint-staged`（package.json）：**pre-commit 仅对本次提交改动的文件强制 `any: error`**，从根源阻断新 `any` 流入。
- React 专属规则（react-hooks / jsx-a11y）受限于沙盒无网络未安装，配置中已留注释说明联网后接入方式。

### 3. Vitest 覆盖率阈值（2026-08-14 二次校准：istanbul + TSX 纳入）
- **历史**：v8 provider 无法插桩 TSX（PARSE_ERROR），渲染层组件长期被排除在覆盖率外。
- **现状**：切换 `@vitest/coverage-istanbul`（可插桩 TSX），并给 monaco-editor 加 resolve alias 解决 istanbul 解析冲突；**渲染层 TSX 组件已纳入覆盖率统计**。
- **阈值**（2026-08-14 实测含全部 TSX）：statements 14 / branches 10 / functions 12 / lines 15（留安全余量防 CI 抖动）。当前实测 ~16/12.5/14/17；随组件测试增加，每里程碑上调。
- **测试规模**：36 个测试文件 / 284 用例（含事件总线、keybindings、多语言索引、插件 worker 隔离、CLI 路径、DAP inspector、agent 纯函数等新增测试）。

### 4. CI + pre-commit 强制门禁
- `.github/workflows/quality-gate.yml`：push/PR 到 `main`/`develop` 时执行 `npm ci → npm run lint → npm test -- --coverage`，必须全绿才可合并。
- `.github/workflows/ci.yml`：tsc ×2 + eslint + vitest + 构建 + Playwright e2e（冒烟 + 工作流）。
- `.husky/pre-commit`：提交时运行 `npx lint-staged`（阻断新 `any` 与真实 lint error）。

## 二、门禁当前真实状态（2026-08-10 实测）

| 检查项 | 状态 | 说明 |
|---|---|---|
| `tsc --noEmit`（双配置） | ✅ 绿 | 0 错误（`config/tsconfig*.json`） |
| ESLint | ✅ 绿 | `npm run lint` 可跑：0 errors（存量 `any` 警告见 `npm run lint:any-count`） |
| `npm test` | ✅ 绿 | 27 文件 217 用例全过（含权限存储集成、破坏性操作审批、symlink 路径穿越用例） |
| `npm test -- --coverage` | ✅ 绿 | v8 实测 stmts 25.5 / branch 22 / funcs 25.9 / lines 27.3（阈值 22/18/22/24） |
| e2e | ✅ 绿 | 冒烟 + 工作流（打开文件夹 → Monaco 编辑 → 保存落盘 → Git 面板 → diff 视图） |

**历史失败用例**：`src/agent/agent-tools.test.ts > blocks symlink escape`
- 早期在 symlink 受限的沙盒环境中失败（`realpathSync` 受限），属环境限制非代码缺陷；
- 在 Windows 本地与 ubuntu CI 上该用例正常通过，现已纳入全绿基线。

**发布配置注意**（electron-builder）：
- `publish.url` 为占位域 `https://updates.loom-ide.example/`——接入真实更新服务器前不要使用 `npm run build:publish`（`--publish=always` 会失败）；本地构建请用 `npm run build`。
- `npmRebuild: true`：`node-pty` 是原生模块，打包时必须按 Electron ABI 重新编译，否则打包版终端功能崩溃。CI 的 windows runner 自带编译工具链。

## 三、团队落地运行手册

1. 联网安装依赖：`npm install`
   （拉齐 `eslint` / `@eslint/js` / `typescript-eslint` / `@vitest/coverage-v8` / `husky` / `lint-staged`）
2. 启用 pre-commit：`npx husky init`（生成 `.husky`，`pre-commit` 钩子已就绪）
3. 日常节奏：
   - 提交 → husky 自动 `lint-staged` → 新 `any` / 真实 lint error 被挡下，无法入库。
   - CI 自动跑 lint + test + coverage，未达阈值或有 error 则阻断合并。
   - 看 `any` 指标：`npm run lint:any-count`（目标逐步归零）。
4. 本地全量自查：`npm run quality`（= `npm run lint && npm test`）。

## 四、Phase 2 分阶段拧紧（待办）

- [ ] `noUncheckedIndexedAccess`：94 处，优先修安全关键路径（`command-policy` / `path-permissions`），其余随文件改动逐步消除；归零后写入 tsconfig。
- [ ] `any` 清零：当前约 650 处（main 269 / renderer 265 / agent 114 / shared 2）。新代码已被 pre-commit 阻断；存量随模块改动清理。归零后将仓库级 `no-explicit-any` 翻 `error`，并退役 `eslint.config.staged.mjs`。
- [ ] React ESLint 插件：联网装 `@eslint-react/eslint-react` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y`，按 `eslint.config.mjs` 顶部注释接入 hook / a11y 规则。
- [ ] 渲染层覆盖率：换 `@vitest/coverage-istanbul`（或为组件测试补 jsdom 环境），把 `src/renderer/**/*.tsx` 重新纳入覆盖率，然后整体阈值 +10pp。

## 五、对团队技术提升的意义

- 门禁让"好代码"有了**客观、可自动执行的标准**，新成员照着过线即可上手。
- pre-commit 阻断任何新 `any` / lint error 流入，**技术债务不再增长**。
- 覆盖率阈值 + CI 强制，倒逼测试文化落地。
- 这是"团队技术水平提升"的基石；后续可接：标杆代码评审、编码规范与模式库、结对重构核心模块。
