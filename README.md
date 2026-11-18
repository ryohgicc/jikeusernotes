# 即刻私人备注

Chrome / Edge 本地扩展。在即刻网页版昵称后显示「+ 备注」，点击后填写私人备注；已有备注显示为「（备注内容）」，点击可修改，清空后保存即可删除。

## 安装

1. 在 [GitHub 仓库](https://github.com/ryohgicc/jikeusernotes) 点击「Code → Download ZIP」并解压，或克隆仓库：`git clone https://github.com/ryohgicc/jikeusernotes.git`。也可使用单独提供的扩展 ZIP。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」（Edge 可能显示「加载解压缩的扩展」）。
4. 选择直接包含 `manifest.json` 的文件夹。GitHub ZIP 通常解压为 `jikeusernotes-main`，克隆目录为 `jikeusernotes`，单独提供的扩展 ZIP 解压为 `jike-notes`。
5. 打开或刷新 <https://web.okjike.com/following>，点击昵称后面的「+ 备注」。

安装后不要移动或删除该文件夹。替换扩展代码后，在扩展管理页点击「重新加载」，再刷新即刻网页。

## 数据和权限

- 备注绑定个人主页链接里的用户标识 `username`，不按显示昵称匹配；同名用户互不影响。如果即刻更改这个标识，旧备注需要重新关联。
- 数据使用 `chrome.storage.local`，仅当前浏览器配置文件可见。切换即刻账号仍共用这份本地备注，不会显示给别人，也不上传到即刻。
- 支持刷新保留、多标签页更新、滚动加载的新动态，以及页面中符合结构的昵称链接。
- 点击浏览器工具栏的扩展图标，可导出 JSON 备份或导入备份；导入会合并，同一用户以导入值为准。
- 不自动跨设备同步，不向即刻 App 添加备注。卸载扩展、删除浏览器配置文件或清除扩展存储会删除本地数据，请提前导出。
- 仅申请扩展存储权限，内容脚本仅运行于 `https://web.okjike.com/*`；没有远程脚本、遥测或网络请求。

## 实现与验证

原生 JavaScript、Manifest V3，无依赖、无需构建。`content.js` 识别 `/u/<username>` 昵称链接，通过 DOM 观察器处理动态内容；备注是独立按钮，不覆盖原昵称或原链接。`popup.js` 提供备份。

语法检查：

```bash
node --check content.js
node --check popup.js
python3 -m json.tool manifest.json
```

2026-11-18 已检查即刻公开发布的页面代码中昵称链接和布局结构。Chrome 无头浏览器自动化使用该结构的本地测试页面验证交互，扩展存储 API 使用测试替身。已通过新增、修改、删除、取消、刷新保留、同名隔离、多处显示、动态加载与移除、链接复用、存储变更通知、保存失败处理、纯文本安全及备份导入导出检查；JavaScript 和 manifest 语法检查通过。未在你的已登录会话中安装或验证。即刻更新页面结构或路由后可能需要适配；头像链接、纯文本昵称及非标准姓名组件不保证覆盖。
