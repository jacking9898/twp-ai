# 页渡 · Yedu 发布指南

仓库：`jacking9898/twp-ai`。当前准备版本：`0.1.0`，状态为待发布。本指南不自动推送或上传。

## 发布前

1. 确认 `src/manifest.json`、`src/firefox-manifest.json`、`package.json` 和锁文件根版本一致，并填写 CHANGELOG。显示名为 页渡 · Yedu，Firefox ID 为 `twp-ai@jacking9898`。
2. 审阅全部准备提交的改动，包含新增文件；不要仅提交 README 而遗漏新增的扩展脚本。确认 `.local-data/`、真实密钥、浏览器用户目录、个人导出和未授权第三方数据没有被跟踪。`.gitignore` 不会移除已经跟踪的文件。
3. 使用 `npm ci`，运行 `build-instructions.md` 中的测试，执行 `npm run build` 和 `npm run test:release`。
4. 在独立浏览器配置中安装最终构建目录，检查网页双语、文本对比、设置的「关于」和更新记录。测试付费 API 时仅使用自己的测试账号；自动化回归使用本机假接口。
5. 在授权发布后提交源码、推送并为该提交创建版本标签（例如 `v0.1.0`）。从这个干净的标签重新构建和检查，避免发出与源码不一致的安装包。

## GitHub Release 附件

- `Yedu_<版本>_Chromium_MV3.zip`：解压后加载，适用于 Chrome / Edge。
- `Yedu_<版本>_Firefox.zip`：当前为实验性、未签名构建，不宣称可直接在正式版 Firefox 永久安装。
- `Yedu_<版本>_Source.zip`：对应的可编辑源码、依赖锁文件和构建说明。
- `SHA256SUMS.txt`：以上三个 ZIP 的 SHA-256。

Release 文案可以使用 CHANGELOG 对应条目，并链接安装说明、PRIVACY.md 和已知限制。上传源码包以及公开对应源码，是保留 MPL 源码获取渠道的一部分。不要把普通源码快照误当成可以直接加载的已构建扩展。

## 浏览器商店另行处理

GitHub Release 不等于商店上架。商店提交需要使用本 fork 的开发者账号和独立扩展身份，提供准确的用途、权限理由、隐私政策及必要的用户数据声明。Firefox 构建还需要完成签名、当前数据收集声明/同意机制要求的核对和真实浏览器验证。此仓库的发布准备不表示已通过商店审核。

- [Chrome 用户数据政策说明](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Firefox 附加组件政策](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- [Firefox 扩展 ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/)

不复用上游商店地址、扩展 ID、更新描述符、赞助账号或签名密钥。仓库目前没有设置自托管自动更新服务；要添加时应单独实现并验证。
