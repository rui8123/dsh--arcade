部署到云端（免费，拿到固定网址）
====================================

目标：不依赖你电脑一直开着，得到一个长期有效的网址，手机随时能开。


方案一：Render（推荐，免费且免信用卡）
-------------------------------------
前提：需要一个 GitHub 账号（免费）。

第 1 步：把文件放进一个 GitHub 仓库
  1. 打开 https://github.com/new ，仓库名随便填（例如 dsh-arcade），选 Private 也可以
  2. 创建后点「Add file → Upload files」
  3. 把本文件夹里的这些文件全部拖进去（不要拖整个文件夹，拖文件）：
        arcade.html
        gomoku-server.mjs
        package.json
        render.yaml
        Procfile
        railway.json
        .gitignore
  4. 点「Commit changes」

第 2 步：在 Render 部署
  方法 A（用蓝图，最省事）：
    1. 打开 https://dashboard.render.com/ ，用 GitHub 登录
    2. 点 New +  →  Blueprint
    3. 选中刚才那个仓库  →  Apply
    4. 等 1~2 分钟

  方法 B（手动创建）：
    1. New +  →  Web Service
    2. 选中仓库
    3. Runtime 选 Node
    4. Build Command 填：  npm install --omit=dev
    5. Start Command 填：  node gomoku-server.mjs
    6. Instance Type 选 Free
    7. 点 Create Web Service

第 3 步：拿到网址
  Render 会给你一个 https://dsh-arcade-xxxx.onrender.com 这样的地址，
  手机浏览器打开即可，两个游戏都在，五子棋联机也能用。

第 4 步：邀请好友
  五子棋 → 联机对战 → 创建房间 → 复制邀请链接（链接会自动用云端域名）


注意事项
--------
· 免费实例 15 分钟没人访问会「休眠」，再次打开需要 20~40 秒唤醒，
  页面转圈是正常的，不是挂了
· 对局进行中 SSE 长连接会保持实例活跃，不会中途睡
· 网址固定，不会像临时隧道那样每次变
· 免费额度：每月 750 小时运行时间，单个服务够用


方案二：Railway（备选）
----------------------
  1. https://railway.app 用 GitHub 登录
  2. New Project → Deploy from GitHub repo → 选仓库
  3. 它会自动识别 Procfile（web: node gomoku-server.mjs）
  4. Settings → Networking → Generate Domain 拿网址
  说明：Railway 新账号只有试用额度，长期免费不如 Render 稳。


方案三：自己的云服务器（最自由）
--------------------------------
  1. 买一台最便宜的 Linux（1C1G 就够，Ubuntu 22.04）
  2. 装 Node 20：
       curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
       sudo apt install -y nodejs
  3. 把 arcade.html 和 gomoku-server.mjs 传上去（scp 或宝塔面板）
  4. 用 PORT=80 启动：
       PORT=80 node gomoku-server.mjs
     （想常驻就用 pm2：npm i -g pm2 && pm2 start gomoku-server.mjs --name arcade）
  5. 浏览器访问 http://服务器IP ，或绑定域名


环境变量
--------
· PORT：Render/Railway 会自动注入，代码里已读取 process.env.PORT；本地默认 8765
· 其它不需要配置


部署后自检
----------
  浏览器打开  https://你的域名/            → 应该看到「游戏厅」首页
  命令行验证  curl -X POST https://你的域名/api/create
              → 应返回 {"room":"1234","seat":1,...}


常见问题
--------
· 打开是 502 / 一直在转圈
  Render 冷启动中，等 30 秒再刷新
· 部署日志报 "Cannot find module"
  确认 gomoku-server.mjs 和 arcade.html 在同一层目录（仓库根目录）
· 页面能开但不能联机
  检查是否用了 https（混合内容会被浏览器拦），Render 默认就是 https
