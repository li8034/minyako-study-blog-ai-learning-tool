# Minyako的学习日志

`sdxx/blog/` 是一份可直接上传、可继续二次配置的公开版本模板。

## 项目优势

- 支持直接导入 Markdown 与 PDF，并自动生成独立文章目录。（PDF标注尚未完成）
- 支持正文高亮、批注、AI 解释、批注汇总，适合做长期学习档案。
- 文章以文件夹存储，正文、批注、渲染缓存、图片与 PDF 附件可以放在一起，迁移和备份都很方便。
- 分类目录、顶部搜索、可收纳侧边栏和可配置 LLM 设置已经内建，开箱即可继续扩展。
- 默认配置已经脱敏，适合上传到 GitHub 或作为新的个人学习站模板。

## 使用须知

### 目录说明

```text
sdxx/
  README.md
  blog/
    index.html
    app.js
    styles.css
    serve_blog.py
    requirements.txt
    content/
      categories.json
      settings.json
      pages/
        README.md
```

### 启动方式

1. 进入 `sdxx/blog/`
2. 安装依赖：`pip install -r requirements.txt`
3. 启动服务：`python serve_blog.py`
4. 浏览器打开：`http://127.0.0.1:8876/index.html`

也可以直接运行 `start_blog.bat`。

### 内容导入

- 通过页面中的“导入文档”上传 `.md` 或 `.pdf`。
- 导入后系统会在 `content/pages/<page-id>/` 下创建文章目录。
- 每篇文章可独立保存 `article.md`、`meta.json`、`notes.json`、`rendered.html` 和 `assets/`。

### LLM 配置

- 默认 `content/settings.json` 中不含私有密钥。
- 建议复制 `content/settings.local.example.json` 为 `content/settings.local.json` 后再填写私有配置。
- 当前后端兼容 OpenAI 风格 `chat/completions`、`responses`，也兼容以 `/v1` 结尾的 Base URL 自动补全。


## 实现逻辑

### 前端

- `index.html` 提供博客框架、侧边栏、顶部栏、导入弹窗、设置弹窗、批注弹窗与 LLM 问答弹窗。
- `app.js` 负责页面加载、分类树渲染、文章搜索、选区识别、高亮与批注写入、批注汇总展示、AI 解释请求和本地 UI 状态保存。
- `styles.css` 负责蓝白主色的卡片式布局、可收纳侧边栏、自动显隐顶栏和文章阅读界面样式。

### 后端

- `serve_blog.py` 使用 Python 标准库 HTTP 服务提供静态页面和 JSON API。
- 后端负责 Markdown/PDF 导入、PDF 文本提取、分类维护、设置读写、文章元数据管理、批注落盘与 LLM 转发请求。
- PDF 导入依赖 `pypdf` 提取文本，因此文章既能保留原始 PDF，也能参与全文搜索与选词解释。

### 数据组织

- `content/categories.json` 保存分类。
- `content/settings.json` 保存默认站点设置与 LLM 参数模板。
- `content/pages/<page-id>/` 作为文章模块单元，便于整篇复制、归档、同步和清理。
- 批注与高亮不只存在于前端，而是连同文章状态一起保存，便于后续继续编辑。

## 适合的使用场景

- 个人学习博客
- 课程笔记整理
- 科研资料归档
- 带 AI 术语解释的阅读系统
- 需要本地保存批注与附件的知识库
