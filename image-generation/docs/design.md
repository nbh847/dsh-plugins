# 图片生成插件设计

## 已确定需求

1. 作为 Cordis 插件接入 DeepSeek Harness 插件列表。
2. 在系统设置插件列表中可以启用、关闭。
3. 遵循宿主 Agent Tools 接口，注册后可被 Agent 调用。
4. 使用 SenseNova U1.5 Lite。
5. 工具一次同步调用直接返回生成结果：`generate_image` 内部调用官方同步接口并等待响应（2026-10-02 用户决策；原「先创建任务、再每 5 秒轮询」需求因官方无异步契约而废弃，见 API 核对状态）。
6. API Key 由用户在环境变量文件中配置。
7. 插件在独立路径维护，dsh 通过外部引用加载；插件由父目录 `dsh-plugins` 仓库统一管理并推送保存。

本次交付仅包含文档及配置文件，以下均为后续实现设计。

## 独立项目与加载边界

插件源码、包清单、构建配置、测试及可能需要的客户端配套模块均保存在本项目。dsh 不复制插件代码，也不通过修改其源码注册每个外部插件；后续核对宿主支持的外部包／模块引用机制，在部署的 profile 中配置引用。

开发时引用本地独立插件，由父目录仓库统一使用 Git 保存；Git 仓库地址不等于 Cordis 可加载的运行入口，具体安装、构建与加载方式须与宿主契约一致。插件应导出标准入口，依赖宿主公开包，不硬编码当前机器的 dsh 源码路径。

现有设置页启停能力的差异单独核对，优先采用宿主已有扩展点和插件管理服务。若确实需要修改宿主通用 UI 能力，先说明具体范围，不将外部插件代码搬入宿主来规避该差异。

## 宿主集成依据与差异

2026-10-02 只读检查了本地宿主以下入口：

- `/Users/mac/workspace/opensource/deepseek-harness/packages/core/tools/README.zh.md`：工具通过 `ctx.tools.register()` 注册，schema 由宿主传入模型工具体系。
- `/Users/mac/workspace/opensource/deepseek-harness/packages/boot/plugin-manager/README.zh.md`：profile 插件通过配置条目的 `disabled` 管理启停；是否即时生效取决于 HMR；Agent 预设条目保持只读。
- `/Users/mac/workspace/opensource/deepseek-harness/packages/host/plugin-inventory/README.zh.md`：插件清单是 Loader 的只读投影，不负责启停。
- `/Users/mac/workspace/opensource/deepseek-harness/packages/client/ui-settings-plugins/README.md`：系统设置的内置插件清单只读，配置入口在侧栏插件页面。

因此，“在系统设置列表中启停”需要后续宿主 UI 集成，不能仅添加 Host 插件就宣称完成。具体修改点须核对实际运行版本后确定。规划沿用宿主已有插件管理服务，避免另建一份启用状态。

独立外部插件的边界已确定；包名、profile／bundle 引用方式、Agent 预设可见性及客户端配套包在实现前确定，不假设仅注册全局工具就能绕过预设能力限制。

### 宿主接口核实结论（2026-10-02，基于运行版本 0.2.0-rc.2 源码）

- 插件形态：纯 host 插件即可，无需客户端包。profile bundle 列出包名后，宿主读取包的 `dsh.bundle.patch` 指向的 patch 文件，经 `- insert` 条目导入包的 ESM 入口，命名导出 `apply(ctx)` 即 object plugin 生效；需要客户端界面时才声明 `dsh.client` 与 `./client` 导出。
- 工具注册：`ctx.tools.register()` 配合宿主 `defineTool` DSL；`parameters` 使用宿主的 JSON Schema 方言，`output` 必须同时声明 `schema` 与 `render`；`execute(args, exec)` 返回可 JSON 化的值，抛出的异常被宿主包装为结构化工具错误（`ToolErrorInfo { name, code, reason? }`），不会中断会话。真实模板见 `packages/boot/plugin-manager/src/tools.ts`。
- Agent 可见性：在宿主根 context 注册的工具默认进入所有 Agent 的可见工具集，无需编写 preset；preset 可用 `restrict` 过滤，属宿主既有行为。
- 启停：条目级 `disabled` 选项由宿主插件页和 `plugin_manager` 工具写入 profile 的 `cordis.patch.yml`；禁用触发 cordis dispose，`tools.register()` 返回的 disposer 自动执行，无需自建启用状态。设置页内置清单仍只读，结论与上一节一致。
- 配置读取：宿主启动时经 `loadLayeredEnv` 合并继承环境、调用目录 `.env` 与 `~/.dsh/.env`（非 bootstrap 前缀变量在未定义时写入 `process.env`）；插件直接读 `process.env.SENSENOVA_API_KEY`。不得使用 `DSH_` 前缀命名新变量。
- 包清单惯例：peerDependencies 中 `@deepseek-ai/dsh-*` 声明为 `^0.2.0-rc.2` 可通过兼容性检查（含 prerelease 语义），无需豁免；`^0.2.0` 会被判不兼容，禁用。构建产物 `lib/index.js`，`type: module`。
- 超时与取消：注册表不强制超时，仅声明 `timeoutMs` 的工具受默认 timeout-policy 约束；取消经 `exec.signal` 传播，工具体必须把该信号传给内部 HTTP 请求，否则取消只替换结果、请求仍在后台执行。

## API 核对状态

2026-10-02 完成核对。官方文档已全文读取，异步任务接口经全量核实不存在，官方唯一公开契约为同步接口。

### 官方唯一契约：OpenAI 兼容同步图像接口

来源：[SenseNova 官方文档站 U1.5 Lite 章节](https://platform.sensenova.cn/docs) （2026-10-02 经真实浏览器渲染读取正文，接口标题即为「同步图片生成」）；与[商汤官方接入公告](https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741) 一致，字段冲突处以文档站为准。逐字段记录：

- 端点与方法：`POST https://token.sensenova.cn/v1/images/generations`（文生图，仅输入文本 prompt）；`POST /v1/images/edits`（同步图片编辑，含参考图，本项目未要求）。
- 鉴权：`Authorization: Bearer <API_KEY>`，Token Plan 的 `sk-` 密钥，与 profile 中 sensenova provider 的 `SENSENOVA_API_KEY` 同源。
- 请求参数（文档站参数表）：
  - `model`：string，必填，`sensenova-u1.5-lite`。
  - `prompt`：string，必填，图像生成描述。
  - `size`：string，默认 `auto`；或 2K／4K 常量，或 `{宽}x{高}`（32 的倍数，512–4096，最大比例 3:1、1:3；建议 2048x2048、2720x1536 等）。
  - `n`：integer，默认 1，**仅支持值为 1**。
  - `watermark`：boolean，默认 true；`false` 生成无水印纯图（公测期间免费，官方建议显式传参防止默认值变更）。
  - `response_format`：string，默认 `b64_json`；可选 `url`（24 小时有效的临时下载地址）；`data[].b64_json` 与 `data[].url` 不同时返回。
  - `output_format`：string，默认 `png`；可选 `jpeg`、`webp`；不控制返回方式。
  - `prompt_extend`：boolean，默认 true，提示词自动润色，扩写失败时回退原始 prompt。
- 响应：`created`（时间戳）、`data[]`（`url` 或 `b64_json`）、`output_format`、`size`、`usage`（`input_tokens`、`input_tokens_details`、`output_tokens`、`total_tokens`、`images_count`）。
- 行为：同步阻塞返回，一次请求直接给出最终结果；无任务 ID，无查询端点。返回的图片 URL 24 小时后失效。
- 该接口独立于 Chat Completions，Chat 接口不支持图像输出。

### 异步任务接口不存在的证据链

- [SenseNova 官方文档站](https://platform.sensenova.cn/docs) 全站标题枚举（2026-10-02 浏览器渲染读取）：U1.5 Lite 与 U1.5 Fast 章节均仅有「同步图片生成」「同步图片编辑」两个接口，接口标题官方即标注「同步」；全站（概览、鉴权、各模型、兼容接口、错误码、工具接入）无任何异步任务或任务查询接口页面。
- [SenseCore 官方帮助中心 sitemap 全量枚举](https://console.sensecore.cn/micro/help/sitemap.xml) ：`model-as-a-service/nova` 目录下仅有图文对话、语音、实时交互、文件、模型管理等页面，无任何图片生成或异步任务接口文档。
- [商汤官方 U1.5 Lite 接入公告](https://www.sensetime.com/cn/news/sensenova-u1-5-lite-token-plan-20260911-1741) 全文：仅同步接口，未提及创建任务、任务 ID 或查询端点。
- 多轮定向搜索（中文、英文、site 限定 sensecore.cn／sensetime.com、GitHub、第三方生态）：命中的异步任务模式均属其他厂商或第三方中转站，无 SenseNova U1.5 Lite 异步接口的官方痕迹。

### 实现路径决策记录

原需求第 5 条「先创建生成任务，再每 5 秒轮询一次生成结果」以存在异步任务契约为前提；官方契约只有同步接口，无任务 ID 可轮询，曾按施工清单红线停在核对阶段。

2026-10-02 用户决策：**采用官方同步接口实现，放弃 5 秒轮询设计**。工具在一次调用内发出同步长请求并等待响应，通过宿主 `timeoutMs` 与 `exec.signal` 实现超时与取消；不添加无契约依据的任务轮询，不做伪装的两阶段流程。

## 计划实现结构

| 计划文件 | 职责 |
| --- | --- |
| `src/index.ts` | Cordis 入口、工具注册、生命周期资源释放 |
| `src/config.ts` | 环境变量读取与配置校验 |
| `src/sensenova.ts` | 同步生成请求、响应校验与错误归一 |
| `tests/` | 工具生命周期、请求契约、超时取消及失败路径验证 |

构建与包清单按宿主外部插件惯例建立（`lib/index.js` 产物、`dsh.bundle.patch`、peer `^0.2.0-rc.2`）；纯 host 插件，无客户端包。

## 工具与流程约定

工具名 `generate_image`。参数按已核实官方契约设计：`prompt`（string，必填非空）；`size`（string，选填，透传官方取值）；`watermark`（boolean，选填，默认 `false` 生成无水印纯图——公测免费，且避免官方 Logo 加在用户创作图上；官方亦建议显式传参防止默认值变更）。`model` 固定 `sensenova-u1.5-lite`、`n` 固定 1（官方仅支持 1）、`response_format` 固定 `url`（官方默认 `b64_json` 会把整图 Base64 写入工具结果，不可接受；`url` 为 24 小时临时链接）；密钥、服务地址与模型配置不作为 Agent 可覆盖参数。

一次工具调用即一次同步生成请求：校验配置与输入，`POST /v1/images/generations` 并携带 `exec.signal`，等待响应后校验结构，返回图片 URL、实际尺寸与 token 用量。请求超时或失败不自动重试，避免重复扣费。

禁用或卸载时通过注册返回的 disposer 与 `AbortController` 终止进行中的请求；远端已受理的生成无法取消，不承诺停止已计费任务。插件内总等待由工具声明的 `timeoutMs` 与请求超时共同控制，具体值实现时按官方无 SLA 的实际情况取保守上限。

缺少密钥时返回可解释的配置错误且不发起请求，不影响宿主启动。日志和错误必须脱敏：不记录 Authorization 头与密钥，错误信息仅透出 API 错误码与 message。

## 验收标准

- 插件可被 Harness 发现，并通过宿主侧栏插件页的 `disabled` 机制启停，真实反映宿主状态。
- 启用且配置有效时工具按宿主规则进入目标 Agent 工具列表；禁用或卸载后撤销注册，无遗留请求。
- 一次工具调用只发出一次生成请求；请求携带 `exec.signal`，超时与取消后不重试。
- 覆盖空提示词、缺少密钥、鉴权失败、限流、网络失败、无效响应、生成失败、超时与取消。
- 模拟接口测试不访问真实服务；取得用户授权后使用本地配置执行一次真实调用，记录脱敏结果与契约，密钥不进入测试产物。
- 执行插件必要类型检查、测试及构建，宿主集成按实际改动运行相关检查；未通过前保持未验收状态。
