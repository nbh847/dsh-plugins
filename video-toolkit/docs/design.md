# Video Toolkit 插件设计

## 目标与接口

独立 Cordis bundle `dsh-plugin-video-toolkit`，以 HyperFrames 项目绝对路径为共同输入，通过宿主公开 Tools 接口同步等待检查、截图和 MP4 渲染结果。三个工具整体启停，不增加视频创作、自动修复、云渲染、发布或逐工具开关。

| 工具 | 输入 | 原生调用 | 返回 |
| --- | --- | --- | --- |
| `video_lint` | `project_path` | `lint <project> --json` | 原生 JSON findings，区分检查违规与命令失败 |
| `video_snapshot` | `project_path`、1--9 个 `timestamps` | `info --json` 查询时长；`snapshot --at ... --no-end --describe false --output ...` | 逐帧路径、秒数、3 列拼图及持久化图片引用 |
| `video_render` | `project_path` | `render <project> --output ...` | 非空 MP4 路径、字节数、持久化文件引用和对话文件交付记录 |

所有调用通过包解析定位固定依赖 `hyperframes@0.8.111` 的 CLI，不在工具调用时执行 `npx latest`，也不执行目标项目 npm scripts。三个超时分别为 120 秒、300 秒和 1800 秒。

## 原生能力与版本依据

官方 [CLI 文档](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/cli.mdx) 与 [PR 视频技能](https://github.com/heygen-com/hyperframes/blob/main/skills/pr-to-video/SKILL.md) 提供 lint、snapshot、render 和 contact sheet 的入口。实现参数与行为以本次查询、下载并核对的 [npm 发布包 0.8.111](https://www.npmjs.com/package/hyperframes/v/0.8.111) 为准，真实运行结果见验证文档。

发布包的 `computeSnapshotTimes` 保留输入顺序和重复项，默认会追加末帧；包装器使用 `--no-end` 防止追加。`createSnapshotContactSheet` 原生固定 3 列、每页 9 张，以带两位索引的帧名排序，末行不足留空。`--describe false` 禁止额外描述模型请求。

`info --json` 提供项目时长；仅接受有限秒数且满足 `0 <= t < duration`，不排序、不去重、不夹取。拒绝空数组、超过 9 项、字符串、负数、NaN、Infinity 和等于或超出时长的值。

`lint --json` 输出 `ok`、`errorCount`、`findings` 等字段；发现错误时原生退出码为 1，属于正常检查结果。诊断对象、无效 JSON 或不一致的退出码视为执行失败。静态合约 lint 不承诺覆盖全部 JavaScript／CSS 语法、运行时和视觉问题。

`render` 使用原生默认 MP4 参数。包装器验证本次产物为非空普通文件，返回实际文件字节数；编码与最终视频有效性由原生渲染流程处理，验收通过 ffprobe 独立核对，不把项目声明值冒充视频探测值。

## 宿主与系统设置

入口使用 `defineTool`、`ctx.tools.register`、标准参数 schema、工具结果 content block 和调用卡片。依赖宿主 `tools`、`subprocess`、`sandbox`、`sandboxPolicy`、`attachments` 服务；注册与事件订阅均由 Cordis scope 管理。

图片通过 `attachments.saveImage` 返回 image block；MP4 通过 `saveFileStream` 返回 file block。在标准 Agent 会话存在打开的 turn 时，渲染结果只在最终 `tools/result` 成功后追加宿主既有的 `deliverables/presented` 记录，不增加第四个工具。无 turn 时仍保留文件附件和路径，不伪造会话边界。

宿主 `ui-settings-plugins` 是 tab 容器，现有 inventory tab 为只读清单。新增「已安装插件」tab 由宿主 `ui-settings-plugin-inventory` 持有，复用 `remote.pluginManager.listBundles`、`setBundleEnabled` 和变更订阅；禁用的插件不会带走自身管理入口。显示状态以管理器再次读取的结果为准，不用客户端乐观状态替代真实启停结果；失败、配置覆盖、只读与需重启的结果有独立提示。存在包错误但已启用时允许关闭；未启用且有错误时阻止启用，忙碌或只读状态始终禁止切换。

宿主改动仅涉及该设置模块的客户端文件、测试、双语说明、两项 Web 回归测试及生成的客户端标签目录；通过 [集成补丁](../integration/settings-plugins.patch) 交付。补丁可在其他版本宿主应用前检查，不由插件安装钩子修改宿主源码；恢复时仅反向应用该补丁，不重置宿主其他改动。本机目标 profile 为 `web`，保留原有插件和配置。

## 路径、进程与产物

先解析真实项目目录并检查 `index.html`，再按 Agent 的 `sandboxPolicy` 校验真实工作区关系。受限模式拒绝工作区外项目及目录前缀、symlink 绕过；只读模式拒绝截图和渲染。CLI 在宿主 `sandbox.confine` 下执行，不能在沙箱配置失败后降级为不受限运行。

执行使用 argv 数组，不拼 shell 命令。受管子进程记录 stdout 最多 1 MiB、stderr 最多 64 KiB；stdout 丢失时拒绝成功结果。禁用遥测与更新检测，移除 `NODE_OPTIONS`、`NODE_PATH`，其余敏感环境由宿主子进程服务的过滤规则处理。

调用信号合并用户取消、工具超时和插件 lifetime。每条命令结束后终止并等待本次进程范围；卸载先取消，再等待所有在途任务结算，失败不自动重试。各调用在授权项目中使用唯一 `video-toolkit-*` 目录，避免原生 snapshot 清空输出目录时影响其他调用或用户文件。正式产物保留，不因插件关闭而清理。

## 验收入口

- `pnpm test`：参数、路径、沙箱失败、取消、输出限制、无产物、并发目录和文件交付时序。
- `pnpm typecheck`、`pnpm build`：插件类型与构建。
- `node tests/native.e2e.mjs`：真实合法／违规项目 lint、1／3／4／9 帧拼图、重复帧字节一致和 ffprobe 视频探测。
- `tests/host-smoke.mjs`：仅在可丢弃的 profile 中通过 Loader 加载，配置绝对 `project` 和 `result` 路径，验证实际工具调用、图片读取、启停和在途渲染取消；该脚本会切换测试 profile 插件状态。
- [验证记录](validation.md)：真实 Agent、系统设置点击、持久化和相关检查结果。
