# Minyako的学习日志

一款支持 Markdown / PDF 导入、原文标注、批注汇总与 AI 术语解释的本地学习博客工具。

## 项目特点

- 支持导入 Markdown 与 PDF，并按文章文件夹独立存储内容、元数据与批注。
- 支持正文高亮、手动批注、AI 批注、批注汇总与跳转定位。
- 支持在博客界面中搜索文章、管理分类、配置站点标题与 LLM 参数。
- PDF 页面以网页内嵌阅读器方式渲染，便于后续继续扩展原文标注能力。
- 上传版默认不包含个人文章、私有配置和本机缓存。

## 仓库结构

```text
sdxx/
  .gitignore
  README.md
  docs/
    上传与隐私说明.md
  blog/
    index.html
    app.js
    styles.css
    serve_blog.py
    requirements.txt
    start_blog.bat
    content/
      README.md
      categories.json
      settings.json
      settings.local.example.json
      pages/
        README.md
```

## 启动方式

1. 进入 `blog/`
2. 安装依赖：`pip install -r requirements.txt`
3. 启动服务：`python serve_blog.py`
4. 在浏览器打开：`http://127.0.0.1:8876/index.html`

也可以直接运行 `blog/start_blog.bat`。

## 上传版说明

- 公开仓库默认保留产品代码、基础配置模板和空的内容目录。
- 本地私有配置请填写到 `blog/content/settings.local.json`，不要提交到公共仓库。
- 个人文章导入后会写入 `blog/content/pages/<page-id>/`，上传前请确认是否需要保留。
- 更详细的上传与隐私边界说明见 `docs/上传与隐私说明.md`。
