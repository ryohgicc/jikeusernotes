# 项目工作约定

这是直接加载的 Manifest V3 扩展，无服务端、构建产物或数据库迁移。修改前运行 `git status -sb`，保留与任务无关的改动。

## 命令

- 安装开发依赖：`npm ci`
- 安装测试浏览器：`npx playwright install chromium`
- 语法检查：`npm run lint`
- 浏览器测试：`npm test`
- 完成检查：以上检查加 `python3 -m json.tool manifest.json` 与 `git diff --check`
- 手动开发：在 Chrome / Edge 扩展页加载仓库目录，修改后重新加载扩展并刷新即刻。
- 无需构建、部署或数据库迁移。用户要求推送时，先 fetch 并核对 main 与 origin/main。

`CHROME_PATH` 可指定普通测试浏览器；真实扩展测试使用 Playwright Chromium，或以 `EXTENSION_CHROME_PATH` 指定支持加载未打包扩展的浏览器。

## 文件与数据契约

- `content.js`：昵称备注，`jkn.note.<username>` -> 备注原文。不要更改用户已有备注。
- `reading-bridge.js`：页面 MAIN 环境，只读已渲染 React props 的动态 ID，在虚拟列表容器添加 `data-jkn-post`，不接触认证数据或内部查询缓存。
- `reading.js`：隔离环境中的阅读恢复，`jkn.reading.<account>:<route>` -> `{version:1,id,offset,top,savedAt}`。此命名空间不得用于备注备份。
- 阅读分割线仅在精确恢复成功后显示，绑定本次恢复的动态 ID 与原偏移；覆盖绘制、不改变列表高度或拦截点击。滚动与虚拟列表重建后重新定位，撤销、切换页面或账号、关闭恢复和清除记录时移除。
- `jkn.settings`：`restoreReading`、`showReadingNotice` 默认为 true；关闭后停止记录与恢复，保留记录。
- `jkn.settings` 有效期：`readingExpiryEnabled` 默认为 true，`readingMaxAgeDays` 默认为 7，须为 1～365 的整数。过期记录不自动恢复或续期，主动浏览后才更新；关闭有效期限制则长期有效。
- `jkn.readingResetAt`：清除通知；活动页面须放弃待保存快照与恢复任务，直到用户主动浏览。
- `popup.html` / `popup.js`：设置、清除阅读记录与备注备份。清除或导入不能影响其他命名空间。
- 真实即刻适配变化须更新 fixtures 与 README；不要把模拟页面通过描述成用户登录环境已验证。

行为改变时更新 README、CHANGELOG，并同步 manifest 与 package 版本。不得新增远程代码、令牌读取、遥测或无关权限。
