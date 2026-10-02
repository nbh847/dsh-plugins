# 文字转语音插件设计

## 需求与边界

作为独立 Cordis 插件进入 DeepSeek Harness 插件列表，在系统设置插件列表可启用和关闭；遵循 Agent Tools 标准，被目标 Agent 调用。用户传入文本及音色，API Key 通过服务端环境变量配置。

当前只建立文档和配置模板，不编写插件实现、不修改宿主、不提交或推送。2026-10-02 用户已授权使用本地环境配置执行一次直接 API 音频生成测试，该测试不代表插件集成验收。

## API 核对记录

2026-10-02：用户指定的 [百炼控制台文档](https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-audio-tts-http-api) 无法通过网页读取工具打开；已读取同主题的 [阿里云官方 HTTP API 文档](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api) 正文。

2026-10-02 检查点 1 完成全量核对，来源与日期如下：

- [官方 HTTP API 文档](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)（页面更新于 2026-09-28）：仅北京地域；`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`，Bearer 鉴权、JSON 请求；`model`、`input.text`、`input.voice` 必填；`input.format` 默认 `mp3`，`input.sample_rate` 默认 22050；支持非流式及 SSE。非流式结果包含 `request_id`、`output.finish_reason`（`stop`）、`output.audio.url`（24 小时有效）、`output.audio.expires_at` 及用量；用量字段按模型区分，`qwen-audio-3.0-tts-flash` 返回 `usage.characters`（计费字符数），`qwen-audio-3.1-tts-flash` 返回 token 三元组。
- [官方音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)（页面更新于 2026-09-29）：音色必须属于当前模型的音色列表，`longanhuan_v3.6` 属于 `qwen-audio-3.0-tts-flash`；不匹配返回 `InvalidParameter`；官方提供各模型基础音色下载列表且可能更新，插件不硬编码音色表。
- [官方 Python SDK 文档](https://www.alibabacloud.com/help/zh/model-studio/qwen-audio-tts-python-sdk)：单次调用待合成文本不得超过 20000 字符，超出返回错误。
- [官方错误码文档](https://help.aliyun.com/zh/model-studio/error-code)：错误响应结构为 `{code, message, request_id}` 配 HTTP 状态码；`401-InvalidApiKey`、`429-Throttling` 为典型项；音色与模型不匹配报引擎 418；文本超限报 `Range of input length should be [1, xxx]`。
- 本账号地面真值：`.tmp/audio-smoke/test.py` 冒烟测试（2026-10-02 13:53）确认当前账号可经业务空间专属域名以 `format: wav`、`sample_rate: 24000` 成功合成。

## 工具与流程（已确定）

工具名 `text_to_speech`；参数为非空 `text`（string，必填）和可选 `voice`（string）。指定音色优先于环境默认音色；两者均未配置时返回明确配置错误。输入只校验不改写：空文本、超 20000 字符直接拒绝且不发起请求。

服务端固定项：模型取 `DASHSCOPE_TTS_MODEL`（默认 `qwen-audio-3.0-tts-flash`，官方示例且本账号冒烟已验证），音色取 `DASHSCOPE_TTS_VOICE`（默认 `longanhuan_v3.6`），`format` 固定 `wav`、`sample_rate` 固定 24000（冒烟验证过的组合）。密钥、业务空间、地域、服务地址与固定项不作为 Agent 可覆盖参数。

首版采用非流式请求，成功返回音频 URL、到期时间 `expires_at`、`request_id` 与用量（3.0 模型为 `characters`）；不添加任务轮询。请求应有总超时并响应取消；超时后不自动重试，避免重复生成和计费。异常与日志脱敏：不记录 Authorization 头与密钥，错误仅透出 HTTP 状态、API code、message 与 request_id。

超时方案与生图插件一致：工具声明 `timeoutMs: 300_000`（官方无延迟 SLA，取保守上限），由宿主 timeout-policy 派生请求截止；`exec.signal` 透传给内部 HTTP 请求，取消立即终止本地请求，远端已受理的合成无法撤销，不承诺计费终止。

暂不扩展音色创建或复刻、流式播放、SSML、长文自动拆分、音频下载持久化及自动重试。格式等额外工具参数待明确需要后再加入。

## 宿主集成（2026-10-02 核对，宿主运行版本 0.2.0-rc.2）

宿主接口结论与生图插件一致并经本次抽查复核：

- 插件形态：纯 host 插件。profile bundle 列出包名，宿主读取包 `dsh.bundle.patch` 指向的 patch 文件，经 `- insert` 条目导入包 ESM 入口，命名导出 `apply(ctx)` 生效；`inject: ['tools']` 等待宿主工具注册表。
- 工具注册：`ctx.tools.register(defineTool({...}))`；`parameters` 为宿主 JSON Schema 方言；`output` 必须同时声明 `schema` 与 `render`；`execute(args, exec)` 返回可 JSON 化的值，异常被宿主包装为结构化工具错误。模板见宿主 `packages/boot/plugin-manager/src/tools.ts`。
- Agent 可见性：根 context 注册的工具默认进入所有 Agent 可见工具集。
- 配置读取：宿主启动时经 `loadLayeredEnv`（`packages/boot/app-boot/src/index.ts:234`）合并继承环境、启动目录 `.env` 与 `~/.dsh/.env`，不覆盖已存在变量；插件直接读 `process.env`，不使用 `DSH_` 前缀。
- 启停：宿主侧栏插件页与 `plugin_manager` 工具写 profile 的 `disabled` 条目，禁用触发 cordis dispose，`tools.register()` 返回的 disposer 自动执行。
- 系统设置插件列表：`packages/client/ui-settings-plugins/README.md` 核对，内置清单为只读部署级清单；公开槽位 `settings.plugins.tab` 仅支持贡献设置页 tab，不提供外部插件进入内置清单启停的公开路径。

结论：首版启停走宿主既有侧栏插件页机制，真实反映宿主状态；「系统设置插件列表启停」需宿主 UI 集成（修改宿主或新增客户端配套包），超出本次授权范围，单独记录为待用户决策事项，不在本 Goal 宣称完成。

缺少配置不影响宿主启动，不发起请求。插件禁用、卸载时撤销注册、取消请求与计时器，不承诺远端生成或计费一定终止。

## 实现结构（2026-10-02 交付）

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | Cordis 入口、`text_to_speech` 工具注册、300 秒超时、输入校验与音色解析 |
| `src/config.ts` | 环境变量读取与校验，北京业务空间端点派生 |
| `src/bailian.ts` | 非流式合成请求、响应契约校验、超时取消与脱敏错误 |
| `tests/` | 生命周期、配置、请求契约与失败路径测试（全 mock，不访问真实服务） |

包名 `dsh-plugin-text-to-speech`，构建产物 `lib/index.js`，经包内 `dsh.bundle.patch`（`cordis.patch.yml`）以 `- insert` 条目接入宿主 profile，peer 依赖 `@deepseek-ai/cordis ^4.0.2`、`@deepseek-ai/dsh-tools ^0.2.0-rc.2`。

补充记录：`usage.characters` 按官方计费口径统计，汉字按 2 字符计（2026-10-02 真实验证：16 字文本返回 27 = 12 汉字 ×2 + 3 标点 ×1）。

## 验收结果（2026-10-02）

- 类型检查与构建通过；20/20 模拟测试通过，覆盖空文本、长度边界与超限、无默认音色、缺少配置、鉴权失败、限流、网络失败、无效 JSON、缺少结果字段、超时及取消；错误不含密钥；单次调用最多一个请求，取消后无残留。
- 插件 0.1.0 安装至宿主 web profile，与 image-generation 并存；headless 宿主运行时验证工具发现、真实合成（有效 WAV）、`disabled: true` 禁用后工具消失、还原后恢复、卸载干净。
- 未完成：系统设置列表启停（需宿主 UI 集成，须用户另行授权）；Web UI 侧栏交互验证（待密钥同步至 `~/.dsh/.env` 后重启验证）。

## 待确认项

1. 系统设置插件列表启停：需宿主 UI 集成，须用户另行授权后作为独立事项实施；侧栏插件页启停为首版方案。
2. 宿主中的音频展示方式：工具结果以 JSON 字符串返回 URL 与到期时间，实际渲染由宿主会话界面决定，实现后在检查点 4 记录。

## 验收标准

- 插件可发现、加载，符合宿主 Agent Tools 类型与 schema，目标 Agent 可调用。
- 音色参数实际进入 `input.voice`；省略时使用有效默认值，否则给出明确错误。
- 覆盖空文本、超长文本、无效音色、缺少密钥、鉴权失败、限流、网络异常、无效响应、超时及取消；输入失败不请求，单次调用不重复提交。
- 禁用或卸载后工具消失，进行中的本地请求终止，无资源残留。
- 系统设置列表启停可交互并反映实际状态；未完成时单独标记，不宣称完整验收。
- 类型检查、模拟测试、构建通过；模拟测试不访问真实 API。用户配置密钥并授权真实调用后验证一次实际合成，核对指定音色和有效音频，不输出密钥。
