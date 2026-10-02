# Video Toolkit 验证记录

环境：2026-10-02，macOS，Node.js 24.21.0，DeepSeek Harness 0.2.0-rc.2，HyperFrames 0.8.111。使用项目内 fixture，320×180、1 秒；测试工作文件位于父仓库 `.tmp/video-toolkit/`，正式示例与脱敏结果保留在本目录 `artifacts/`。

## 原生功能

通过 `tests/native.e2e.mjs` 在含中文和空格的真实路径执行官方 CLI，未模拟浏览器或编码器。合法 fixture lint 通过，缺少 composition 的违规项目返回 3 个错误，仍作为正常 findings 结果处理。

| 时间点数量 | 原生拼图列数／行数 | 图片尺寸 |
| --- | --- | --- |
| 1 | 3／1 | 1816×372 |
| 3 | 3／1 | 1816×372 |
| 4 | 3／2 | 1816×740 |
| 9 | 3／3 | 1816×1108 |

输入刻意包含乱序、重复时间点和 `0`、`0.99`。帧结果保持输入顺序，两次 `0.1` 的 PNG 字节一致。实际查看 [4 帧拼图](artifacts/contact-sheet-4.jpg) 与 [9 帧拼图](artifacts/contact-sheet-9.jpg)，确认时间标签、位置和末行留空。

原生 render 生成 [示例 MP4](artifacts/sample.mp4)，独立 ffprobe 探测为 H.264、320×180、30 fps、1 秒、13162 字节；原生渲染依赖复用已有 Chrome、FFmpeg 与 FFprobe，没有安装全局依赖。完整数据见 [原生结果](artifacts/native-results.json)。

## 宿主 Agent 与生命周期

将构建后的 npm 包安装到 web profile，经真实 Loader、Tools、沙箱、受管子进程与 Attachments 调用三个工具。验收会话的消息与工具请求由脚本生成，未向模型发起付费请求；三个实际命令、渲染器和宿主服务均为真实实现。

- 启用时恰有三个工具；关闭后列表为空；再次启用恢复三个工具，无重复注册。
- lint 返回 text，snapshot 返回 text＋image，render 返回 text＋file。
- 拼图通过会话附件接口校验引用并读取 29986 字节，图片为 1816×740。
- MP4 在打开的 Agent turn 中追加一条宿主标准文件交付记录；真实对话页中 [MP4 文件卡片](artifacts/agent-mp4-card.png) 可见，认证后的文件 HTTP 请求返回 200、`video/mp4`、13162 字节。
- 实际渲染期间观察到原生 CLI 与 Chrome 子进程，再关闭插件；调用返回「Video Toolkit disabled or unloaded」，观察到的进程全部退出，三个工具撤销。
- 同一实例中图片生成与文字转语音工具仍可发现。

脱敏数据见 [宿主结果](artifacts/host-results.json)。宿主烟雾验证入口为 `tests/host-smoke.mjs`，仅在可丢弃 profile 使用；它会实际切换 `dsh-plugin-video-toolkit` 状态并保留生成产物。

## 系统设置

在隔离 Web 实例中通过真实浏览器点击「设置 → 内置插件 → 已安装插件」，验证关闭、重新启用与禁用时保留入口。关闭后停止该实例，再启动同一个 profile：工具列表为空，设置开关仍为关闭，再次点击能够启用。

- [启用状态截图](artifacts/settings-enabled.png)
- [关闭状态截图](artifacts/settings-disabled.png)

宿主新增 `installed-plugin-settings.e2e.ts`，通过实际 profile manager 与已安装 fixture bundle 执行启用、关闭、再次启用，保存两种 ARIA 预期后以只读 replay 模式核对；测试通过。既有设置页双标签数量预期同步更新。

## 工程检查

- 插件：39 项测试、类型检查与构建通过。覆盖时间点边界、无产物、命令失败、缺 CLI、真实路径和权限、无 shell 参数、取消／超时、日志截断、并发产物目录、卸载等待与文件交付时序。
- 宿主设置模块：35 项单元／注册测试通过，类型检查、客户端构建、局部 lint 和双语文档配对通过。
- 宿主补丁：仅包含目标设置模块、相关 Web 测试及预期记录，以及生成目录中新增的一条标签记录；反向 `git apply --check` 与 `git diff --check` 通过。

宿主文档同步的 43 项门禁分段执行通过：全量类型检查和网站构建先通过；图检查遇到默认 2 GiB 堆上限后，仅为验证进程设置 4 GiB 堆，恢复剩余检查。客户端生成目录首次报告过期，补上新增标签的一条记录后复检通过。宿主全量 `pnpm run lint` 通过；验证进程堆限制与线程数仅用于本次检查，未修改持久配置。

## 环境说明

本次隔离测试 profile 未复制原 profile 的兼容性例外；既有 `dsh-plugin-agent-workflow@0.2.0` 因其要求较旧宿主版本而被宿主跳过，与 Video Toolkit 无关，没有为它新增兼容例外或修改实现。

本机 `PATH` 未找到 FFmpeg／FFprobe；真实验收仅为隔离实例设置两个原生路径环境变量，未将其写入原有服务或真实 `.env`。启动实际使用实例前须按 README 提供这些依赖。

本机原有 Web 服务未被停止或重启；本任务的浏览器和 3091 端口实例归本任务所有，验收结束后关闭。插件源码没有硬编码本机渲染二进制或宿主路径，没有修改 `.env`，未提交、推送或发布。

## 审查修复复验

2026-10-02 20:13：新增回归测试稳定复现启用中的故障包不能关闭。修复后设置模块 35 项测试通过，覆盖故障包关闭后不能重新启用、已关闭故障包不能启用，以及正常启停与只读限制。相关类型检查与客户端构建通过，局部 lint、补丁反向校验和 `git diff --check` 通过。
