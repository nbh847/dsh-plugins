# Video Toolkit

用于 DeepSeek Harness 的 Cordis 插件，包名 `dsh-plugin-video-toolkit`，当前版本 `0.1.0`。通过宿主公开 Agent Tools 接口包装固定版本 HyperFrames `0.8.111`，提供项目静态检查、截图拼图和 MP4 渲染。

## 三个工具

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `video_lint` | `project_path`，HyperFrames 项目的绝对目录路径 | 原生静态合约检查 JSON，包含 findings 和错误数量 |
| `video_snapshot` | `project_path`、`timestamps`，1--9 个秒数 | 原生截图与 3 列拼图，并返回 Agent 可查看的图片附件 |
| `video_render` | `project_path` | MP4 的绝对路径、字节数、持久化文件附件；在 Agent 对话中提供宿主文件交付卡片 |

项目目录须包含 `index.html`。截图时间点满足 `0 <= t < duration`，保留输入顺序和重复项；每行 3 张，9 张为九宫格，末行不足留空。例如：

```json
{"project_path":"/absolute/path/to/project","timestamps":[0,0.5,1,1.5]}
```

每次截图或渲染在项目内新建 `video-toolkit-*` 产物目录，保留已有文件。检查发现违规时仍返回真实 lint findings；命令、依赖或产物失败时返回工具错误，不自动重试。

## 安装与启停

需要 Node.js `^22.19.0 || >=24.0.0`、与 `0.2.0-rc.2` 公开接口兼容的 DeepSeek Harness，以及 HyperFrames 可用的 Chromium、FFmpeg 和 FFprobe。渲染依赖检测由原生 CLI 负责；也可通过其 `HYPERFRAMES_FFMPEG_PATH`、`HYPERFRAMES_FFPROBE_PATH` 指定已有二进制文件。

若 FFmpeg 和 FFprobe 不在 `PATH` 中，可在启动宿主时指定路径，无需修改 `.env`：

```sh
HYPERFRAMES_FFMPEG_PATH=/absolute/path/to/ffmpeg \
HYPERFRAMES_FFPROBE_PATH=/absolute/path/to/ffprobe \
dsh web
```

本次验收使用上述环境变量复用已有二进制文件。本机现有 `PATH` 未找到这两个命令，原有 Web 服务没有被重启或补写环境变量；其渲染可用性须以依赖配置后的运行结果为准。

在本目录执行：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

将生成的包安装到目标 profile：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-plugin-video-toolkit-0.1.0.tgz --workspace-root
```

本机 web profile 已安装并注册此插件。系统设置中的「内置插件 → 已安装插件」可整体启用或关闭；关闭后三个工具撤销，正在运行的任务被取消，状态跨重启保留。

上述设置入口由宿主的 `ui-settings-plugin-inventory` 模块提供。本项目包含 [宿主集成补丁](integration/settings-plugins.patch)，适用于本次验收的宿主源码；应用前在宿主目录运行 `git apply --check`，应用后按宿主构建流程重新构建该模块并重启服务。本机宿主已应用该改动，其他宿主安装插件包时不会自动改写宿主源码。

源码开发版 profile 应使用宿主自己的 Tools 模块，避免加载不同版本的服务身份。本次本地 profile 采用宿主工具包链接；插件运行代码没有硬编码本机宿主路径。

## 运行边界

沿用 Agent 当前文件权限与工作区：受限模式下真实项目路径须位于工作区内；只读模式可 lint，截图和渲染须具备工作区写入权限。使用宿主管理的子进程和沙箱，不执行项目 npm scripts。

工具超时分别为 2 分钟、5 分钟和 30 分钟。用户取消、超时或插件卸载会传播取消并等待子进程清理；产物不会随插件关闭自动删除。截图和渲染会执行项目 HTML 中的代码。

`video_lint` 的检查范围以 HyperFrames 静态合约检查器为准，不能保证覆盖全部 JavaScript／CSS 语法与运行时错误；截图成功也不表示视觉质量通过。

## 验证与文档

- [验证记录](docs/validation.md)：原生截图、MP4、宿主调用、设置页启停与生命周期证据。
- [项目规范](AGENTS.md)
- [接口设计](docs/design.md)
- [当前进度](ROADMAP.md)
- [开发施工清单](goals/20261002-1707-video-toolkit.md)

原生验收脚本在 `tests/native.e2e.mjs`，设置好原生渲染依赖后运行 `node tests/native.e2e.mjs`；结果默认保留在父仓库 `.tmp/video-toolkit/native-validation/`，正式插件不依赖该目录。
