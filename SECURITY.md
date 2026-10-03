# 安全问题

请不要在公开 Issue 中提交 API Key、认证令牌、个人文档或可直接利用的未修复漏洞细节。

如果仓库启用了 GitHub 私密漏洞报告，可以使用 [Report a vulnerability](https://github.com/jacking9898/twp-ai/security/advisories/new)。如果该入口不可用，请先提交不含敏感细节的 Issue，说明需要私下联系维护者；当前尚未设立独立安全邮箱或承诺响应时限。

密钥意外泄露时，应先在对应服务商处撤销并重新生成，再处理仓库或附件中的残留。删除当前文件不能清除已经公开的 Git 历史。

AI Key 存储在本机扩展 IndexedDB 中，普通设置导出不含 AI Key，但本地存储不是加密保险库。部署第三方代理、模型接口及处理不可信文档前，请核实其来源。项目处于早期版本，隐私细节见 [PRIVACY.md](PRIVACY.md)。
