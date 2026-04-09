# content

这里保存博客运行时加载的内容数据。当前这份上传模板不附带任何现成文章，适合作为公开仓库或初始化版本。

## 结构

```text
content/
  categories.json
  settings.json
  settings.local.json
  pages/
    <page-id>/
      article.md
      meta.json
      notes.json
      rendered.html
      assets/
```

## 说明

- `categories.json` 保存侧边栏分类列表。
- `settings.json` 保存可公开提交的默认配置。
- `settings.local.json` 用于本地私有配置，不应上传到公共仓库。
- `pages/<page-id>/` 是单篇文章目录，便于连同批注和附件一起迁移。
- `notes.json` 保存高亮、批注与 AI 解释结果。
- `rendered.html` 保存当前文章的可交互渲染状态。
- `assets/` 保存图片、PDF 和其他附件。

## 初始化建议

- 首次使用时，先在 `pages/` 下新建文章目录，再导入 Markdown 或 PDF。
- 如果需要配置大模型，请复制 `settings.local.example.json` 为 `settings.local.json` 后再填写私有信息。
