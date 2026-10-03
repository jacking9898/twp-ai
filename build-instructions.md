# 构建 页渡 · Yedu

## 环境

- Node.js 22.18+，建议 Node.js 24；当前开发验证环境为 Windows + Node.js 24。
- npm，依赖版本由 `package-lock.json` 锁定。
- 常规构建不需要 Python、GitHub Token、AI Key 或签名密钥。

## 安装依赖并构建

在仓库根目录或 Release 的 Source ZIP 解压目录运行：

```sh
npm ci
npm run build
npm run test:release
```

`npm ci` 需要访问 npm 仓库。构建读取本机依赖，将 AI SDK 打包到扩展中，并复制本地静态资源；不会下载第三方提示词、访问用户浏览器资料或请求翻译服务。`build/` 是可再生输出，每次完整构建都会清空重建，不要存放个人文件。

生成目录（版本取自 manifest）：

```text
build/
  TWP_AI_0.1.0_Chromium_MV3/
  TWP_AI_0.1.0_Firefox/
  Yedu_0.1.0_Chromium_MV3.zip
  Yedu_0.1.0_Firefox.zip
  Yedu_0.1.0_Source.zip
  SHA256SUMS.txt
```

Chromium：在扩展管理页启用开发者模式，加载对应构建目录。Firefox：通过 `about:debugging` 临时加载 Firefox 目录下的 `manifest.json`；正式安装需要单独签名。

Source ZIP 保留可编辑源码、依赖锁文件、构建工具、测试与许可资料；不包含 node_modules、个人数据、签名密钥和 AI 后台 bundle，后者会在构建时重新生成。完整构建也会从 `polyfill.js` 和锁定依赖重新生成安装包里的 polyfill，确保组件版本与许可清单一致。`npm run polyfill` 可单独更新源码目录中继承的 polyfill 文件。

默认将 source map 留在安装包内，不引用上游的 source map 服务器。旧命令 `npm run build:local-sourcemaps` 仍可用，与普通 build 的 source map 策略相同。构建没有自托管更新地址，也不会上传或自动发布。

## 测试

```sh
npm run test:ai
npm run test:sidebar
npm run test:background
npx playwright install chromium
npm test
npm run test:extension
npm run test:ai-extension
npm run test:pdf-cache
npm run test:release
```

Windows 默认使用本机 Edge。其他平台默认使用 Playwright Chromium，也可设置环境变量 `TWP_BROWSER_CHANNEL=chromium`。PowerShell 示例：

```powershell
$env:TWP_BROWSER_CHANNEL = 'chromium'
npm run test:ai-extension
```

真实扩展测试先执行完整 build，并使用 `build/` 中自动创建的隔离浏览器目录。AI 集成测试只启动本机模拟接口，不读取个人 API Key。测试结果验证行为与消息传递，不代表所有第三方真实接口的可用性。Firefox 尚未接入对应实测。

## 许可证与可选工具

`npm run licenses` 从锁文件对应的已安装浏览器生产依赖收集许可文本（排除 PDF.js 仅供 Node 使用的可选原生 canvas）。新增依赖缺少许可文件时会停止构建，需要先核实补充来源。`licenses/` 内的补充来源见 `docs/license-sources.md`。

构建的 `pdf-copy` 步骤把锁定版本 PDF.js 的 legacy 解析器、worker、CMaps、标准字体、WASM 和 ICC 资源复制到 `lib/pdfjs/`，随目录保留资源许可。浏览器不从 CDN 加载 PDF 代码；源码包保留锁文件和构建脚本，通过 `npm ci` 还原这些依赖。`test:pdf-cache` 在隔离浏览器中使用实际三页 PDF 和本机模拟 API，验证原件渲染、文字提取、导出、缓存跨重启保留、有效期、清空、取消和网页刷新恢复。

`npm run build:sign` 是可选的本地 Chromium CRX 打包工具，会弹出密钥文件选择框；它不等于商店签名或上架。请保管好自己的密钥，不要使用上游的密钥或把它放进仓库。

完整发布顺序、对应源码和商店事项见 [发布指南](docs/releasing.md)。
