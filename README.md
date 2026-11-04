# 接龙助手

Windows 微信接龙管家自动填表应用，当前交付版本 **1.1.0**。

选择一个微信群，使用本人的「姓名、单位、职工号、所属部门」自动填写新发布的接龙管家小程序表单。关闭设置页后继续后台运行，不使用全局鼠标键盘，不依赖 Codex 或远程桌面。

## 使用

从仓库 Releases 下载 **JielongAssistant-Setup-1.1.0.exe**，双击安装，再打开桌面的「接龙助手」。无需管理员权限或安装开发工具。按四步向导填写资料、完成本人登录、选择群、启动监听。设置完成后直接进入状态页。

开机自启默认关闭，可以在应用中选择开启；登录 Windows 时仅启动后台，不弹设置页。微信稍后就绪时自动重试已授权的监听。停止监听后不自动恢复。升级保留资料、登录和报名记录；卸载移除程序及其自启项，保留用户数据。安装包目前未数字签名，企业策略可能阻止运行。

也可下载便携 ZIP，完整解压，双击「启动接龙助手.vbs」；便携版不提供开机自启设置。

详细操作见 [使用说明](delivery/使用说明.txt)，实测结果与限制见 [验收记录](delivery/验收记录.md)。

1.1.0 安装、升级、卸载及自启测试见 [安装版验收](docs/installer-1.1.0.md)。本轮没有增加官网报名时延样本，也未进行整机重启测试。

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

Windows 虚拟环境命令路径改为 `.venv\Scripts\python.exe`。测试不需要真实聊天库或本人登录态。当前回归为 56 项 Node；微信读取模块沿用已通过的 24 项 Python 测试，其中 34 种表单场景使用隔离网页，不是 34 次官网提交。

## 构建 Windows 包

```sh
npm ci
python3 delivery/prepare-runtime.py
python3 delivery/build.py
python3 delivery/build-installer.py
```

安装包构建需要 NSIS 的 `makensis`（本次使用 3.13，macOS 可通过 Homebrew 安装）。下载器仅从锁定清单里的运行时/依赖来源获取文件，并核对 SHA-256，不执行下载的安装脚本。构建输出在 `release/`，不进入 Git 历史；Setup.exe、便携 ZIP 和 SHA256SUMS 单独保存为 Release 附件。

安装器使用当前用户目录、当前用户快捷方式及卸载注册项。卸载按构建时文件清单逐项删除，不递归清空安装目录。覆盖安装通过本机认证 API 等待在途任务并退出旧版，不强杀其他 Node 或微信进程。

`delivery/verify-package.mjs` 验证文件清单与设置页；`wechat-bridge/verify-windows.py` 是开发用 Windows 原生检查入口。原生检查与真实微信卡片验收是独立项目，不能互相替代。

## 数据与分发

个人资料、官网登录态、聊天缓存、密钥和任务记录保存在本机用户数据目录，绝不进入仓库。Windows 密钥缓存使用当前用户的 DPAPI 保护。首次仍需本人登录微信与接龙管家。

第三方只读组件来源、修改和许可证见 `wechat-bridge/vendor/jla_readonly/UPSTREAM.json` 及相邻 LICENSE 文件。本项目未授予其他部分公开开源许可证。

## 历史原型

根目录的 `server.mjs`、`qq.mjs`、Swift 文件和 `public/` 保留早期 QQ/macOS 原型；不是当前 Windows 交付入口。历史开发说明存放在 `docs/history/`，其中进度仅代表当时状态。当前状态以本 README 和 `delivery/验收记录.md` 为准。
