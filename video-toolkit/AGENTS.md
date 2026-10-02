# Video Toolkit 插件规范

## 定位与边界

独立 Cordis 插件，名称为 `video-toolkit`，包名为 `dsh-plugin-video-toolkit`，通过 DeepSeek Harness 公开接口注册 `video_lint`、`video_snapshot`、`video_render`。仅包装 HyperFrames 原生能力，不另写静态检查器、截图引擎或视频编码器。由父仓库统一管理，不建立嵌套仓库。

## 目录与职责

- `README.md`：当前真实状态和文档入口。
- `ROADMAP.md`：进度、待核对接口与验证记录。
- `docs/design.md`：工具契约、宿主接入方案、执行边界与验收标准。
- `goals/`：开发施工清单、检查点和验收记录；创建文档不等于启动 Goal。
- `src/`：工具注册、原生 CLI 包装与执行边界。
- `tests/`：单元测试、HyperFrames fixture、原生及宿主可选验收入口。
- `integration/`：宿主系统设置集成补丁。
- `docs/artifacts/`：脱敏验收数据和示例产物；临时工作文件放在父仓库 `.tmp/<task-slug>/`。

## 工作流与验证

编码前读取设计，并核对实际 HyperFrames 版本的命令帮助和实现。宿主参考源码为 `/Users/mac/workspace/opensource/deepseek-harness`，不硬编码为插件运行依赖；读取其规范后才进行宿主改动。

系统设置列表显示与启停属于明确需求，不得以侧栏插件管理或 headless 工具发现替代验收。优先使用宿主公开 slots、插件管理与工具注册接口，避免复制插件状态或修改宿主核心。确需修改宿主时先说明具体范围，并遵守文件系统权限。

工具必须响应取消和卸载；进程调用使用参数数组，不拼 shell 命令，不执行项目自定义 npm scripts。不得自动升级目标项目、安装全局依赖或发布产物。验证要求见设计文档。
