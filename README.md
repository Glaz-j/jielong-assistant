# 接龙助手

Windows 微信接龙管家自动填表应用，当前交付版本 **1.0.0**。

选择一个微信群，使用本人的「姓名、单位、职工号、所属部门」自动填写新发布的接龙管家小程序表单。关闭设置页后继续后台运行，不使用全局鼠标键盘，不依赖 Codex 或远程桌面。

## 使用

从仓库 Releases 下载 Windows ZIP，完整解压，双击「启动接龙助手.vbs」。按设置页依次填写四项个人资料、登录本人的接龙管家、读取微信账号并选择目标群，然后启动监听。

详细操作见 [使用说明](delivery/使用说明.txt)，实测结果与限制见 [验收记录](delivery/验收记录.md)。

已在 Windows 11、微信 4.1.15.56、Edge 156 上验证；两张真实群卡片分别在 2.352 秒、2.058 秒完成官网提交。只有两次完整链路样本，不保证其他版本或网络异常下始终低于 10 秒。正式业务表单尚未验收，当前字段依据需求截图，自建测试表单验证。

## 实现

- `wechat-bridge/`：Python 只读数据库接收组件，按账号和群编号监听，检查小程序身份并解析活动地址；认证主库/WAL 快照，持久化游标和事件。
- `silent-worker.mjs`：固定后台任务队列，Playwright 无窗口 Edge 填写、提交并记录结果；按官网稳定活动编号去重。
- `browser.mjs`、`profile.mjs`、`core.mjs`：字段识别、四项资料、提交前校验与结果确认。
- `delivery/`：本机设置页、启停控制、Windows 启动器及分发构建。
- `tests/`、`wechat-bridge/test_*.py`：自动回归。未知字段、额外授权、收费、验证码或不明确的提交结果会停止处理。

## 开发与测试

Node.js 24、Python 3.13；Windows 运行需要已安装 Microsoft Edge 和微信。非 Windows 仅用于开发与隔离测试，不代表微信读取兼容。

```sh
npm ci
npx playwright install chromium
npm test
python3 -m venv .venv
.venv/bin/python -m pip install cryptography zstandard
.venv/bin/python -m unittest discover -s wechat-bridge -p 'test_*.py'
node delivery/app.mjs
```

Windows 虚拟环境命令路径改为 `.venv\Scripts\python.exe`。测试不需要真实聊天库或本人登录态。当前回归为 53 项 Node、24 项 Python，其中 34 种表单场景使用隔离网页，不是 34 次官网提交。

## 构建 Windows 包

```sh
npm ci
python3 delivery/prepare-runtime.py
python3 delivery/build.py
```

下载器仅从锁定清单里的运行时/依赖来源获取文件，并核对 SHA-256，不执行下载的安装脚本。构建输出在 `release/`，不进入 Git 历史；交付 ZIP 和 SHA256SUMS 单独保存为 Release 附件。

`delivery/verify-package.mjs` 验证文件清单与设置页；`wechat-bridge/verify-windows.py` 是开发用 Windows 原生检查入口。原生检查与真实微信卡片验收是独立项目，不能互相替代。

## 数据与分发

个人资料、官网登录态、聊天缓存、密钥和任务记录保存在本机用户数据目录，绝不进入仓库。Windows 密钥缓存使用当前用户的 DPAPI 保护。首次仍需本人登录微信与接龙管家。

第三方只读组件来源、修改和许可证见 `wechat-bridge/vendor/jla_readonly/UPSTREAM.json` 及相邻 LICENSE 文件。本项目未授予其他部分公开开源许可证。

## 历史原型

根目录的 `server.mjs`、`qq.mjs`、Swift 文件和 `public/` 保留早期 QQ/macOS 原型；不是当前 Windows 交付入口。历史开发说明存放在 `docs/history/`，其中进度仅代表当时状态。当前状态以本 README 和 `delivery/验收记录.md` 为准。
