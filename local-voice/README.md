# 本地视频中文配音（实验版）

选用 faster-whisper small.en（GPU，int8_float16）→ OPUS-MT en-zh（CPU）→ GPT-SoVITS v2Pro（GPU，FP16）。第一版支持英语转简体中文、中文字幕直接配音。无需训练；默认音色使用官方 CosyVoice 示例的 3.48 秒中文参考语音，固定来源和 SHA-256 保存在本机 `reference-source.json`，参考样本不随安装包分发。可用自己的 3–10 秒中文 WAV 和对应文字替换参考音频。

当前版本仍是实验实现：实际视频中，逐条按字幕时长拉伸配音会出现语速忽快忽慢，同步和听感尚未达到稳定可用的程度。时间轴测试验证调度和状态恢复，不代表实际语音质量合格。目前只支持一个全局参考音色，尚未实现播放前采集讲者原声、按人物或系列保存并复用音色。

## 安装与启动

Windows、Python 3.11 / 3.12、NVIDIA CUDA 显卡、ffmpeg（加入 PATH）。当前目标机器为 RTX 3050 8GB。安装期间需要网络，运行期间模型全部从本机读取。建议预留至少 12GB 磁盘空间（主模型及中文发音辅助权重约 2.7GB，另有 CUDA/PyTorch 和依赖）。大文件从 ModelScope 镜像下载，逐个核对固定 Hugging Face 修订的 SHA-256；小配置文件直接从固定修订获取。

在仓库根目录运行：

```powershell
./local-voice/setup.ps1
./local-voice/start.ps1
```

`start.ps1` 默认独立后台运行，等待模型加载完成并显示 `Ready` 后才可连接；关闭启动终端不会关闭服务。重复执行会检测已有服务，不重复加载模型。日志在 `.local-data/voice/server.log` 和 `server.err.log`。电脑重启后需再次启动。若终端限制独立后台进程，可在普通 PowerShell 窗口运行 `powershell -ExecutionPolicy Bypass -File ./local-voice/start.ps1 -Foreground`，保持该窗口打开，按 Ctrl+C 停止。

若希望使用自己的中文参考语音：

```powershell
./local-voice/setup.ps1 -ReferenceAudio 'C:/audio/reference.wav' -ReferenceText '这段音频里实际说出的中文。'
```

安装脚本失败后可以重跑，已下载文件会复用。源码版本和模型修订保存在 `.local-data/voice/upstream-revision.txt`、`model-revisions.json`；再次运行不更新已有源码或模型。setup 最后会实际翻译并合成 `.local-data/voice/smoke.wav`，同时载入 ASR 检查显存。完成此测试才代表模型已可运行。旧版本的 Windows 合成参考音色可用 `.local-data/voice/.venv/Scripts/python.exe local-voice/download_reference.py --upgrade-default` 升级，旧样本自动备份；自定义参考音色不会被覆盖。换参考音色后需重启服务。

重新加载扩展并刷新视频页，在 YouTube / B 站播放器页渡菜单点击「开启本地中文配音」。更多设置可测试连接、选择字幕或音频模式。配音不会自动开启。目标语言固定为简体中文，与在线字幕翻译设置独立。

「实时识别配音语速」只用于没有字幕时间轴的音频识别，可选择 0.75–2 倍，并按网站记住。字幕同步模式不使用此设置，而是用实际音频长度除以该条字幕的 `end - start`，将整段配音匹配到这条字幕的起止时间；视频倍速仍由播放器控制，保持音调。字幕同步开启时此语速选项禁用。

## 播放行为

- 有可读字幕时，逐条使用 SRT/VTT 或平台字幕里的起止时间，提前合成当前位置后约 60 秒（最多缓存 64 段）。长、短配音都匹配该条字幕的完整时段。拖动、暂停恢复和播放器缓冲恢复时校准到视频位置，日常播放容忍时钟小幅抖动，避免不断跳转音频造成卡顿。模型未及时完成时保留原声、继续播放；迟到结果只从当前对应位置播放，过期字幕不补播。特别短或不准确的字幕时段仍会影响听感。
- 没有文字字幕时，读取当前视频元素的音轨，优先在语音停顿处提交 PCM 分段，连续讲话最长约 8 秒一段。识别、翻译、合成完成后顺序播放，新配音不会打断上一段。推理和播放分别最多保留两段待处理内容，持续跟不上时丢弃过期片段。画面不会自动延迟，因此此模式仍有延迟。
- 第一段配音就绪后静音原视频，替换整个原声（包括背景音乐）。关闭、跳转到其他视频、广告、服务失败或当前字幕配音未就绪时会恢复原声。扩展不会主动暂停或恢复视频。字幕配音跟随视频时钟，实时模式暂停或拖动、倍速变化时丢弃旧请求和旧音频。菜单会标明实际使用的是「字幕同步配音」还是「实时配音（与画面有延迟）」，自动模式找不到可读字幕时仍会使用后者。
- 受 DRM 或跨域限制的音频可能无法读取；此时停止并提示使用字幕或导入 SRT/VTT。不会申请麦克风或捕获整个桌面。
- 暂不提供音色克隆 UI、说话人分离、背景音乐保留、口型同步或无延迟保证。

## 本地数据与接口

模型、独立环境、参考 WAV 都在被 Git 忽略的 `.local-data/voice/`，不进入扩展安装包。服务只监听 `127.0.0.1:8765`，不接受网站 Origin；扩展通过自定义请求头和短期会话令牌访问。没有开放 CORS。推理串行执行，缓存只在内存中，最多约 32 MB。运行不下载模型、不记录音频、字幕或请求内容。关闭服务释放模型显存。

客户端音频来自 `HTMLMediaElement.captureStream()`，该接口的音频捕获独立于元素静音；合成音频通过独立 Web Audio 输出，避免再次识别自己的配音。参考：[W3C 媒体捕获规范](https://www.w3.org/TR/mediacapture-fromelement/)。当前用 ScriptProcessor 做分段，后续可替换为 AudioWorklet。

上游：[faster-whisper](https://github.com/SYSTRAN/faster-whisper)、[OPUS-MT en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)、[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)。第三方源码和模型按各自许可获取，不随扩展包分发。
