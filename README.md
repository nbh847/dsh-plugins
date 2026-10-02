# dsh-plugins
个人 DSH 插件集合，包含 image-generation 图像生成、text-to-speech 文字转语音与 video-toolkit 视频工具插件。

每个插件使用独立子目录，由本仓库统一管理，与 DeepSeek Harness 宿主源码分离。

- [image-generation](image-generation/README.md)：SenseNova U1.5 Lite 图片生成插件，提供 `generate_image` 工具，当前版本为 `0.1.1`。
- [text-to-speech](text-to-speech/README.md)：百炼 Qwen-Audio-TTS 文字转语音插件，提供 `text_to_speech` 工具，当前版本为 `0.1.0`，已实现并通过宿主真实调用验收。
- [video-toolkit](video-toolkit/README.md)：HyperFrames 工具插件 `0.1.0`，提供静态 lint、3 列截图拼图和 MP4 渲染，支持系统设置启停。
- [仓库规范](AGENTS.md)
- [仓库进度](ROADMAP.md)
