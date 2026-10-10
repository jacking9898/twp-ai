# 完整离线英汉词典

本地数据源：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，固定修订 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b` 的 `stardict.7z`。使用完整压缩词库，不使用仓库的约 76 万条基础 CSV 或示例 mini CSV。

实际统计：3,402,564 条记录，其中 3,386,028 条有中文释义、353,134 条有音标、2,044,859 条含空格（短语、复合词及其他多词条目）。这些是记录数量，不代表同样多的常用单词，也不代表每条都有例句或两个口音的音标。各记录的全部 13 个原始字段保留在索引中。部分旧释义和专业释义可能不完整，显示来源便于核对。

## 查询行为

- 单个英文词和最多 5 词、80 字符的英文短语先查本地；长句和包含其他符号的选择保持普通翻译流程。
- 简体中文目标下，本地已有中文释义直接用于主译文，不在词典卡片重复显示，不请求外部词典或翻译服务；较长的离线英文释义点击展开。
- 其他目标语言优先显示已有英文定义，需要的释义沿用当前翻译服务翻译。
- 本地未收录时自动查询 Free Dictionary API；本地命中后点击「更多释义与例句」才联网补充。失败时保留已有离线释义。
- 显示可用词形变化；音标没有可靠的口音标记时显示为参考音标，不推断美式或英式。发音沿用浏览器对应口音的语音。
- 当前词条缺少音标时回查明确记录的原形及常见词形候选，显示提供音标的实际词条名称；原形 / 候选词条的音标不标成所选复数或其他变形的音标。
- 在线例句点击后翻译；词库缺少例句、词源或分口音音标时不会编造。
- 英美朗读按钮并排放在单词旁，缺少对应口音音标时不显示占位行。来源和许可证始终可通过「词库来源与许可」展开核对。

词库随 Chrome 和 Firefox 安装包分发，运行时不下载数据库、不访问 GitHub、不加载远程代码。以 UTF-16 FNV-1a 的低 8 位将词条分成 256 个 JSON 索引，查询只读取相应一片，最多保留 6 片的后台内存缓存；并发查询复用正在读取的同一片。词典卡片与查询范围可扩展，未展示的字段仍保留在数据文件中。

## 来源与重建

安装包和 Source ZIP 均包含 `src/data/dictionary/` 对应数据及许可证，因此普通构建无需网络下载词库或安装 Python。

原始下载：[固定版本 stardict.7z](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/stardict.7z)。解压得到 `stardict.csv`，然后运行：

```powershell
python scripts/build-offline-dictionary.py .local-data/dictionary/stardict.csv
node --test tests/offline-dictionary.cjs
```

压缩包 SHA-256：`f370a0ecb58ada758d9dfe739db1667fd4ed87ed3055a4a7cb6c7054ecdf83d6`。

原始 CSV SHA-256：`88fce01e0a30524192a62e363d47eeb036fa17820d5826121b3b419fd67a3996`。

完整统计、字段顺序和每片校验和见 `src/data/dictionary/manifest.json`。上游 MIT 许可见 `licenses/ECDICT-MIT.txt`；保留作者及数据来源署名。转换后的索引继续使用上游数据许可。
