# Text to Speech

DeepSeek Harness 的 Cordis 文字转语音插件，通过阿里云百炼 Qwen-Audio-TTS 将文本合成为音频。

插件独立存放在 `/Users/mac/workspace/dsh-plugins/text-to-speech`，由父目录 `dsh-plugins` 仓库统一管理，作为外部插件被 dsh 引用加载，不进入 dsh 源码树。

## 功能

- Agent 工具 `text_to_speech`：一次调用发出一次非流式合成请求，成功返回 24 小时有效的音频下载 URL、到期时间、请求标识与用量；超时与失败不自动重试，避免重复计费。
- 参数：`text`（必填，中文或英文，1--20000 字符，原样转发不改写）、`voice`（可选，须属当前模型官方音色列表；省略时用服务端配置的默认音色，两者皆无则返回明确错误）。
- 服务端固定 `format: wav`、`sample_rate: 24000`；默认模型 `qwen-audio-3.0-tts-flash`。
- 适配 dsh `0.2.0-rc.2`；经宿主插件管理（侧栏插件页或 `plugin_manager` 工具）启停，禁用后撤销工具注册并终止进行中的请求。
- 与 `generate_image` 等其他插件并存，互不影响。

## 安装

需要 Node.js `^22.19.0` 或 `>=24.0.0`。在插件目录构建安装包：

```sh
pnpm install
pnpm pack
```

在 dsh 源码仓库安装到目标 profile（以 web 为例）：

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-plugin-text-to-speech-0.1.0.tgz --workspace-root
```

重启后 `text_to_speech` 进入 Agent 可用工具列表。卸载：

```sh
pnpm dsh plugin --profile web remove dsh-plugin-text-to-speech --workspace-root
```

## 配置

API Key 等变量由 dsh 宿主从 `~/.dsh/.env` 或 dsh 启动目录的 `.env` 读取；本插件项目内的 `.env` 仅为直接 API 测试使用，dsh 不读取它。字段说明见 `.env.example`。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 是 | 阿里云百炼 API Key；缺失时工具返回可解释的配置错误且不发起请求 |
| `DASHSCOPE_WORKSPACE_ID` | 是 | 北京业务空间 ID，构成专属域名子域；仅支持华北 2（北京） |
| `DASHSCOPE_TTS_MODEL` | 否 | 默认 `qwen-audio-3.0-tts-flash` |
| `DASHSCOPE_TTS_VOICE` | 否 | 服务端默认音色，如 `longanhuan_v3.6`；未配置时调用必须显式传 `voice` |

密钥只在宿主服务端读取，不进入 Agent 工具参数、浏览器配置、日志或工具结果。

## 当前状态

- 2026-10-02：插件 0.1.0 已实现并安装到本地 web profile；20 项模拟测试与类型检查通过；经 headless 宿主完成真实合成验收（有效 WAV，24 kHz 单声道 16 位 PCM）。
- 系统设置「内置插件」列表为宿主只读清单，外部插件的启停入口是侧栏插件页；将该列表改为可启停需宿主 UI 集成，见 `ROADMAP.md` 待确认项。

## 文档入口

- [规范](AGENTS.md)
- [设计](docs/design.md)
- [进度](ROADMAP.md)
- [施工清单](goals/20261002-1355-text-to-speech.md)
