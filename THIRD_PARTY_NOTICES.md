# 第三方声明与来源

## TWP 上游

本项目基于 [FilipePS/Traduzir-paginas-web](https://github.com/FilipePS/Traduzir-paginas-web)，保留其 Git 历史、源码中的归属信息和完整 [Mozilla Public License 2.0](LICENSE)。感谢 FilipePS 及所有贡献者提供翻译引擎集成、网页处理、界面和本地化基础。

页渡 · Yedu 由 jacking9898 独立维护。双语 DOM 翻译、AI 接入、侧边栏、文本对比、自定义专家和发布配置等变更属于此 fork 的开发工作，不代表上游发布。MPL 覆盖文件的修改继续使用 MPL-2.0。本项目新增代码及自行编写的预设也按 MPL-2.0 提供；第三方组件适用其原许可。

## JavaScript 依赖

构建脚本根据锁定的 `package-lock.json` 生成 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)，保存生产依赖的声明和许可文本，并把它放进每个扩展安装包。该清单是生产依赖的保守全集，部分依赖可能被构建工具移除。

- AI SDK、OpenAI-compatible provider 及相关 Vercel 包：Apache-2.0。
- Mozilla PDF.js（`pdfjs-dist`，版本锁定在 `package-lock.json`）：Apache-2.0。解析器、worker、CMaps、标准字体、WASM 图像解码器和 ICC 数据本地打包到 `lib/pdfjs/`，各资源目录保留自身 LICENSE 文件（包括 Foxit / Liberation 字体和图像解码器声明）。可选的 Node 原生 canvas 依赖不打包到浏览器扩展。
- core-js、htmlparser2 等：各自的 MIT / BSD 等许可，以锁文件和随包文本为准。
- AI SDK 内嵌的 zod3-to-json-schema：保留 Stefan Terdell / Vercel 的 ISC 声明。
- `@ai-sdk/provider-utils` 当前 npm 包未附根目录许可文件；其 Apache-2.0 声明来自包元数据，对应项目许可保存在 `licenses/ai-provider-utils.txt`，来源为 [vercel/ai LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)。

## 样式、图标与素材

- W3.CSS 4.13：Jan Egil 和 Borge Refsnes；保留文件头。[官方说明](https://www.w3schools.com/w3css/w3css_downloads.asp)允许免费使用。
- W3.CSS 包含的 normalize.css 片段：Nicolas Gallagher 和 Jonathan Neal，MIT；全文见 `licenses/normalize.css-MIT.txt`。
- 继承的 `gg-*` CSS 图标来自旧版 CSS.GG，MIT；历史声明见 `licenses/css.gg-MIT.txt`，对应 [2019 年许可提交](https://github.com/astrit/css.gg/blob/a99539a934b6b53f367ffa6ac1aa6221f879e08e/LICENSE)。不采用后续改变许可的新版图标。
- 页渡 · Yedu 使用暖橙色折页图标，由内置图像生成工具为本项目制作；源图及完整提示词位于 `assets/branding/reading-icon-v1.*`。旧蓝色 A / 文图标仅保留为设计历史，不用于扩展安装包。图像生成记录不构成商标权或无侵权保证。
- 继承的服务商名称和标识用于识别 Google、Microsoft、Yandex 等服务，商标权利归相应权利人。本项目没有将第三方品牌或其许可声明改称自有。

## 专家与术语

`src/lib/builtinPresets.js` 保留 41 个参考专家类别，提示词由本项目独立编写，按 MPL-2.0 提供。术语数据参考 2026-10-03 保存的 [Immersive Translate terms](https://github.com/immersive-translate/terms) 快照：移除 6 个电子游戏库后保留 30 个库，大量固定译法保留并校订少数问题；其中访问控制保留原有 8 条并扩展为计算机科学，其余参考库的逐语言条数与快照一致。各库保留原作者和来源链接；不得将这些术语数据整体称为本项目独立创作或重新声明为 MPL-2.0。

计算机科学扩展条目及其繁体版本、独立的 LLM / AI 词库由本项目整理，按 MPL-2.0 提供；新增内容的标注不改变参考库原有条目的来源和许可状态。

参考快照未找到明确的根目录再分发许可证，尚未记录另行授权。改写专家提示词、校订术语、公开可读或保留署名均不自动解决第三方集合的公开再分发许可；准备公开发布时仍需确认。完整原始备份及移除的游戏库不随包分发。

可通过设置自行输入有权使用的提示词与术语。转换工具不会自动把第三方数据加入发布源码或构建包，详见 [预设说明](docs/public-presets.md)。

## 取得对应源码

项目源码位于 [jacking9898/twp-ai](https://github.com/jacking9898/twp-ai)。每次发布应同时提供 `Yedu_<版本>_Source.zip`，以及与安装包相同提交的版本标签。安装包中的 `SOURCE.txt` 指明源码位置，构建步骤位于源码包的 `build-instructions.md`。关于修改后分发的要求可参考 [Mozilla 官方 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)，具体以许可证正文为准。
