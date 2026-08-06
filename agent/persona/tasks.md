# 每日任务配置
# 格式：每行一个任务，agent 按顺序执行
# 支持自然语言描述
# 
# === 架构说明 ===
# 点赞/评论/关注/发帖 → Chrome CDP (browser-like.js / browser-comment.js)
# 搜索/用户资料/历史微博 → aione cookie (weibo-search.js)
# 信息流浏览 → agent-browser (Chrome CDP)

# === 上午任务 ===
搜索"大模型"相关微博，对高质量内容点赞评论（Chrome CDP）
发布一条技术分享微博（从内容池选择）

# === 中午任务 ===
浏览微博首页信息流，关注 AI 和编程相关动态（浏览器）
搜索"开源项目"找到有趣的仓库，点赞互动

# === 下午任务 ===
检查新增粉丝，选择性回关（浏览器）

# === 晚间任务 ===
搜索"AI agent"相关微博，参与讨论
发布一条行业观察或学习心得

# === 周期任务（由 workflow engine 自动调度）===
# weibo-feed-monitor    每2小时  搜索+点赞+评论（Chrome CDP）
# weibo-daily-post      每天     定时发帖（Chrome CDP）
