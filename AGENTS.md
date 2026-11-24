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
- 自动恢复查找期间显示覆盖整个视口的不透明遮罩，带淡入、加载呼吸和完成或取消淡出；精确定位并布局稳定后移除。尊重 `prefers-reduced-motion`。Esc、滚轮、页面切换、清除记录和撤销均移除。遮罩不改变信息流布局。
- `loading-view.js`：恢复遮罩视觉组件；显示实际识别的去重动态数量、前台等待秒数和查找/加载/对齐状态，不使用虚构百分比；支持深色、小屏和减少动态效果。不额外增加等待时间。
- 阅读分割线仅在精确恢复成功后显示，绑定本次恢复的动态 ID 与原偏移；覆盖绘制、不改变列表高度或拦截点击。滚动与虚拟列表重建后重新定位，撤销、切换页面或账号、关闭恢复和清除记录时移除。
- `jkn.settings`：阅读位置始终自动采集；`restoreReading` 默认为 false，只负责进入信息流时是否自动恢复。关闭 `restoreReading` 仍记录浏览，悬浮球可手动恢复。已保存的 true/false 配置保持不变。`showReadingNotice` 默认为 true。悬浮球和设置点击不能覆盖已有书签；回顶不会更新书签，直到用户主动继续浏览。
- `jkn.settings` 有效期：`readingExpiryEnabled` 默认为 true，`readingMaxAgeHours` 默认为 24，须为 1～8760 的整数，按实际经过的毫秒数判断。旧 `readingMaxAgeDays`（1～365）仅用于兼容读取，换算为小时；保存设置时移除旧字段。过期记录不自动恢复或续期，主动浏览后才更新；关闭有效期限制则长期有效。
- 恢复每轮预算：120 秒 / 600 步，已加载列表扫描间隔 160ms，触底轮询 800ms、停滞 15 秒暂停；后台暂停预算。中断后回到入口并提供持久「继续查找」，从上轮游标继续，不落到近似位置，不覆盖旧书签。有效期仅约束自动恢复，手动恢复可查找旧记录。
- `jkn.readingResetAt`：清除通知；活动页面须放弃待保存快照与恢复任务，直到用户主动浏览。
- `popup.html` / `popup.js`：浏览器工具栏弹窗的设置、清除阅读记录与备注备份。
- `settings-panel.js`：页面内设置面板，必须与 `popup.js` 保持相同的 `jkn.settings`、阅读清除和备注备份契约。
- `floating.js`：信息流页面悬浮球与三个操作；只调用阅读控制和设置面板，不新增存储命名空间。图标使用 `assets/jike-logo.svg`，通过 `web_accessible_resources` 提供给页面。清除或导入不能影响其他命名空间。
- 真实即刻适配变化须更新 fixtures 与 README；不要把模拟页面通过描述成用户登录环境已验证。

行为改变时更新 README、CHANGELOG，并同步 manifest 与 package 版本。不得新增远程代码、令牌读取、遥测或无关权限。
