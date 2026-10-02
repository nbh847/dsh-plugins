# Image Generation

DeepSeek Harness 的 Cordis 图片生成插件项目，目标模型为 SenseNova U1.5 Lite。

插件独立存放在 `/Users/mac/workspace/dsh-plugins/image-generation`，与 dsh 源码分离。dsh 后续通过外部引用加载本项目，由父目录 `dsh-plugins` 仓库统一管理和推送，具体加载配置待实现时核对。

当前仅有项目规范、设计文档、进度与环境变量文件，尚无实现代码、构建配置或可运行工具。尚未注册到 Harness，也未实现插件开关。

## 配置文件

在本地 `.env` 中填写 `SENSENOVA_API_KEY`。该文件已被 `.gitignore` 排除；可提交的字段说明见 `.env.example`。当前没有环境变量加载程序，填写配置不会发起请求。

模型暂按官方公开示例记录为 `sensenova-u1.5-lite`，仍需与异步任务 API 核对。API 地址待核对，不预填同步接口地址。

## 文档入口

- [项目规范](/Users/mac/workspace/dsh-plugins/image-generation/AGENTS.md) 。
- [设计与验收](/Users/mac/workspace/dsh-plugins/image-generation/docs/design.md) 。
- [开发进度](/Users/mac/workspace/dsh-plugins/image-generation/ROADMAP.md) 。
