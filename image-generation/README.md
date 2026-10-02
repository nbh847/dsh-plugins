# Image Generation

DeepSeek Harness 的 Cordis 图片生成插件，通过 SenseNova U1.5 Lite 从文本提示词生成图片。

插件独立存放在 `/Users/mac/workspace/dsh-plugins/image-generation`，由父目录 `dsh-plugins` 仓库统一管理，作为外部插件被 dsh 引用加载，不进入 dsh 源码树。

## 功能

- Agent 工具 `generate_image`：一次调用发出一次同步生成请求，成功返回 24 小时有效的图片下载 URL、实际尺寸与 token 用量；超时与失败不自动重试，避免重复扣费。
- 参数：`prompt`（必填）、`size`（可选，`auto`／`2K`／`4K`／`{宽}x{高}`，宽高为 512–4096 的 32 倍数）、`watermark`（可选，默认无水印）。
- 适配 dsh `0.2.0-rc.2`；可在侧栏插件页启停，禁用后撤销工具注册并终止进行中的请求。
- 内置「轨迹」等宿主功能不受影响。

## 安装

需要 Node.js `^22.19.0` 或 `>=24.0.0`。在插件目录构建安装包：

```sh
pnpm install
pnpm pack
```

在 dsh 源码仓库安装到 web profile：

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-plugin-image-generation-0.1.1.tgz --workspace-root
```

重启 Web UI 后 `generate_image` 进入 Agent 可用工具列表。卸载：

```sh
pnpm dsh plugin --profile web remove dsh-plugin-image-generation --workspace-root
```

## 配置

API Key 由 dsh 宿主从 `~/.dsh/.env` 或 dsh 启动目录的 `.env` 读取；本插件项目内的 `.env` 仅为字段参考，dsh 不读取它。字段说明见 `.env.example`。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SENSENOVA_API_KEY` | 是 | Token Plan 的 `sk-` 密钥；缺失时工具返回可解释的配置错误且不发起请求 |
| `SENSENOVA_IMAGE_MODEL` | 否 | 默认 `sensenova-u1.5-lite` |
| `SENSENOVA_BASE_URL` | 否 | 默认 `https://token.sensenova.cn`；也接受带 `/v1` 或完整端点路径的填法，自动归一化 |

密钥只在宿主服务端读取，不进入 Agent 工具参数、浏览器配置、日志或工具结果。

## 文档入口

- [项目规范](/Users/mac/workspace/dsh-plugins/image-generation/AGENTS.md) 。
- [设计与验收](/Users/mac/workspace/dsh-plugins/image-generation/docs/design.md) 。
- [开发进度](/Users/mac/workspace/dsh-plugins/image-generation/ROADMAP.md) 。
