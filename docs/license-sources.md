# 补充许可文本来源

检索日期：2026-10-03。构建只读取本机的这些文本，不联网更新。

| 本地文件 | 来源 |
| --- | --- |
| `licenses/Apache-2.0.txt` | https://www.apache.org/licenses/LICENSE-2.0.txt |
| `licenses/ai-provider-utils.txt` | https://raw.githubusercontent.com/vercel/ai/main/LICENSE；用于当前 npm 包遗漏根 LICENSE 的 provider-utils，包元数据声明 Apache-2.0 |
| `licenses/normalize.css-MIT.txt` | https://raw.githubusercontent.com/necolas/normalize.css/master/LICENSE.md |
| `licenses/css.gg-MIT.txt` | https://raw.githubusercontent.com/astrit/css.gg/a99539a934b6b53f367ffa6ac1aa6221f879e08e/LICENSE |

CSS.GG 的新版本许可已经发生变化。本项目沿用的是上游已有的旧版 CSS 图标代码，不从当前主分支引入新图标。旧 npm 2.0.0 的元数据也声明 MIT。若升级图标，应重新核对版本和许可证。

其余生产依赖的完整声明直接读取 npm 包中的 LICENSE / NOTICE。内嵌 zod3-to-json-schema 的 ISC 文本也单独收集；脚本因缺少声明而报错时，不应简单跳过该依赖。
