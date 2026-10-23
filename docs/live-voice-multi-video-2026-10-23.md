# Bob 多视频实时语音翻译实测

测试日期：2026-10-22 至 2026-10-23。结论：目前适合辅助理解，尚不能认定为准确、流畅的实时同传。没有推送本轮改动。

## 测试方式

从用户指定的 [B 站搜索页](https://search.bilibili.com/all?keyword=Bob%20the%20Canadian) 选取不同主题。独立无头 Chromium 加载开发版扩展，真实播放网站视频，读取音轨，调用本机 Whisper / Qwen3 4B / Qwen3-TTS；未把字幕作为翻译输入，也未替换模型响应。浏览器输出静音，避免打扰日常使用。

记录模型返回文字、实际配音开始事件、原声与合成 WAV，并检查暂停和拖动后的状态。这里的“配音播放”指浏览器实际开始播放对应合成音频，并非单纯生成成功。音色接近程度仍需试听确认，没有给出主观相似度分数或逐字准确率。

## 抽测范围与结果

| 视频 | 内容位置 | 成段生成并播放 | 首次配音等待 | 内容延迟中位数 / 最大值 |
| --- | --- | --- | --- | --- |
| [感恩表达](https://www.bilibili.com/video/BV186pZ66Ebm/) | 15–74 秒 | 13 段 | 9.0 秒 | 8.1 / 10.6 秒 |
| [track record / sidetracked](https://www.bilibili.com/video/BV13rpN6FEmj/) | 0–59 秒 | 11 段 | 7.7 秒 | 9.4 / 10.6 秒 |
| [机场英语](https://www.bilibili.com/video/BV1htARzYE82/) | 60–119 秒 | 9 段 | 8.0 秒 | 11.2 / 12.2 秒 |
| [食物课程](https://www.bilibili.com/video/BV1cT28YCEWD/) | 90–124 秒 | 6 段 | 9.4 秒 | 8.8 / 10.0 秒 |

以上合计 39 段连续配音，另有拖动后的复测片段。首次等待以开启采集、开始相应位置播放为起点，使用已加载的模型；内容延迟从原音频片段开始位置算到对应配音真正开始，包含采集、模型处理和排队。没有测完整条视频。

前三条在游客浏览器中约一分钟后出现登录提示并暂停，因此只验收已播放片段，不能把它们计为全程通过。原测试脚本仅检查配音开关，可能在网站暂停时仍打印 passed；本轮已补充暂停、登录和付费试听状态记录，区分部分测试结果。

另外尝试 [睡眠与秋天](https://www.bilibili.com/video/BV14gpN6nEYa/)，实际生成了两段配音；网站在约 30 秒结束试听，显示 Charge 3 专属内容。未绕过订阅限制，也不计为完整样本。后台已登录 Chrome 的补充尝试没有取得有效媒体播放，专用后台窗口已关闭；没有复制登录资料或修改日常浏览器配置。

## 发现的质量问题

1. **切句后丢失词义。** 讲过往工作表现时，`...performed in the past.` 被译成“……过去曾表演过”，没有沿用“表现”这个义项。
2. **遗漏与衔接生硬。** `we talk about the things` 被概括成“聊聊天”；承接前段感谢家人的 `For my family and for Jen's family` 被孤立译成“为了我的家人，为了詹的家人”。
3. **普通英文词残留。** 机场片段 `we just call this the parking garage` 被译成“我们 simply 把它叫做停车场”，既混入英文，也弱化了 parking garage 的含义。
4. **正确的简单句不能代表整体质量。** `You have to prepare a sandwich before you can eat it.` 译成“你得先做三明治，才能吃”，比较自然；`kitchenette` 译成“厨房小间”，能够理解但不够地道。
5. **仍有明显延迟。** 前三条识别耗时中位数约 0.28–0.34 秒；识别、翻译、合成总耗时中位数约 3.3–4.8 秒，再加上数秒音频采集与播放排队。机场连续讲话片段的延迟达到约 11–12 秒。

## 修正试验与保留的改动

尝试了完整上文、较小的词汇提示以及英文残留复核。完整上文虽能纠正个别“表现”义项，却也会复述前段或把“乘飞机”带偏；较小提示及复核未稳定改善。实际本地模型回归未通过，所以已撤回全部翻译引擎试验，运行版本保持原状，不把这些问题标为已修复。

本轮仅保留测试工具改进：可指定每个视频的开始位置、采样时长、独立结果目录；保存原声和配音；记录实际播放事件与内容延迟；对网页换源造成的 AbortError 做有限重试；识别游客登录和付费试听导致的部分验收。相关 29 项单元检查通过，脚本语法与差异检查通过。

## 本机证据

被 Git 忽略的 `.local-data/voice/evaluation/` 下：

- `multi-20261022/search-results.json`：实际搜索页标题、链接；`summary.json`：汇总指标。
- `bilibili-multi-thankful-before-browser/`、`bilibili-multi-idioms-before-browser/`、`bilibili-multi-airport-before-browser/`、`bilibili-multi-food-browser/`：结果 JSON、截图与成对的 `NNN-source.wav` / `NNN-dub.wav`。
- 习语误译样例：`bilibili-multi-idioms-before-browser/003-source.wav` 与 `003-dub.wav`。
- 食物简单句样例：`bilibili-multi-food-browser/004-source.wav` 与 `004-dub.wav`。

可复测单个片段：

```sh
PLAYWRIGHT_BROWSERS_PATH=.local-data/browsers \
YEDU_LIVE_VIDEO='https://www.bilibili.com/video/BV1cT28YCEWD/' \
YEDU_LIVE_LABEL=food-repeat YEDU_LIVE_START=90 \
YEDU_LIVE_SECONDS=25 YEDU_CAPTURE_AUDIO=1 YEDU_TEST_LOCAL_TRANSLATION=1 npm run test:voice:live
```

优先改进方向是可靠的句段衔接和翻译质量校验，再压缩语音采集与合成等待。仅通过提示词加入整段历史，当前模型的回归结果不足以支持上线。
