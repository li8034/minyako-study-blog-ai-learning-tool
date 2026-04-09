from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from pypdf import PdfReader


BASE_DIR = Path(__file__).resolve().parent
CONTENT_DIR = BASE_DIR / "content"
PAGES_DIR = CONTENT_DIR / "pages"
CATEGORIES_FILE = CONTENT_DIR / "categories.json"
SETTINGS_FILE = CONTENT_DIR / "settings.json"
SETTINGS_LOCAL_FILE = CONTENT_DIR / "settings.local.json"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8876


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def default_settings() -> dict:
    return {
        "common": {
            "siteTitle": "Minyako的学习日志",
            "fontScale": 1.0,
            "defaultSidebarCollapsed": False,
            "compactCards": False,
        },
        "llm": {
            "enabled": False,
            "endpoint": "https://api.openai.com/v1/chat/completions",
            "apiKey": "",
            "model": "gpt-4.1-mini",
            "temperature": 0.2,
            "systemPrompt": (
                "你是一个中文学习助手。请结合给定文章上下文解释用户选中的词或短语，"
                "优先解释它在本文中的含义，再补充必要背景。表达要清晰、准确、面向初学者。"
            ),
        },
    }


def merge_settings(user_settings: dict | None) -> dict:
    merged = default_settings()
    if not isinstance(user_settings, dict):
        return merged

    for group_name in ("common", "llm"):
        if isinstance(user_settings.get(group_name), dict):
            merged[group_name].update(user_settings[group_name])
    return merged


def ensure_content_layout() -> None:
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    if not CATEGORIES_FILE.exists():
        CATEGORIES_FILE.write_text(
            json.dumps(["科研学习/初学手册", "oi学习", "课内学习"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    if not SETTINGS_FILE.exists():
        SETTINGS_FILE.write_text(
            json.dumps(default_settings(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_settings() -> dict:
    base_settings = merge_settings(read_json(SETTINGS_FILE, {}))
    local_settings = read_json(SETTINGS_LOCAL_FILE, {})
    return merge_settings({
        "common": {**base_settings.get("common", {}), **local_settings.get("common", {})},
        "llm": {**base_settings.get("llm", {}), **local_settings.get("llm", {})},
    })


def save_settings(settings: dict) -> dict:
    merged = merge_settings(settings)
    write_json(SETTINGS_LOCAL_FILE, merged)
    return load_settings()


def normalize_category_path(path: str) -> str:
    parts = [part.strip() for part in str(path).split("/") if part.strip()]
    return "/".join(parts) or "科研学习/初学手册"


def extract_title(markdown: str, fallback: str) -> str:
    match = re.search(r"^#\s+(.+)$", markdown, re.MULTILINE)
    return match.group(1).strip() if match else fallback


def extract_summary(markdown: str) -> str:
    lines = []
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#") or line.startswith("```") or line.startswith(">"):
            continue
        lines.append(line)
    text = lines[0] if lines else "导入的学习文档。"
    return text[:120]


def strip_markdown(markdown: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", markdown)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[>*_-]{2,}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def safe_page_id(title: str = "page") -> str:
    ascii_part = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not ascii_part:
        ascii_part = "page"
    return f"{ascii_part}-{secrets.token_hex(3)}"


def page_dir(page_id: str) -> Path:
    return PAGES_DIR / page_id


def page_meta_path(page_id: str) -> Path:
    return page_dir(page_id) / "meta.json"


def page_markdown_path(page_id: str) -> Path:
    return page_dir(page_id) / "article.md"


def page_notes_path(page_id: str) -> Path:
    return page_dir(page_id) / "notes.json"


def page_rendered_path(page_id: str) -> Path:
    return page_dir(page_id) / "rendered.html"


def page_assets_dir(page_id: str) -> Path:
    return page_dir(page_id) / "assets"


def page_pdf_asset_path(page_id: str) -> Path:
    return page_assets_dir(page_id) / "source.pdf"


def page_extracted_text_path(page_id: str) -> Path:
    return page_dir(page_id) / "source.txt"


def load_page_meta(page_id: str):
    return read_json(page_meta_path(page_id), None)


def load_manifest() -> dict:
    ensure_content_layout()
    settings = load_settings()
    categories = read_json(CATEGORIES_FILE, [])
    pages = []

    for entry in sorted(PAGES_DIR.iterdir()):
        if not entry.is_dir():
            continue

        meta_file = entry / "meta.json"
        markdown_file = entry / "article.md"
        if not meta_file.exists():
            continue

        meta = read_json(meta_file, None)
        if not meta:
            continue

        markdown = markdown_file.read_text(encoding="utf-8") if markdown_file.exists() else ""
        page_info = dict(meta)
        page_info["searchText"] = strip_markdown(markdown)[:5000]
        pages.append(page_info)
        categories.append(meta.get("categoryPath", "科研学习/初学手册"))

    unique_categories = []
    for category in categories:
        normalized = normalize_category_path(category)
        if normalized not in unique_categories:
            unique_categories.append(normalized)

    pages.sort(key=lambda item: (item.get("categoryPath", ""), item.get("order", 9999), item.get("title", "")))
    return {
        "siteTitle": settings["common"]["siteTitle"],
        "categories": unique_categories,
        "pages": pages,
        "settings": settings,
    }


def load_page_detail(page_id: str):
    meta = load_page_meta(page_id)
    if not meta:
        return None

    markdown = page_markdown_path(page_id).read_text(encoding="utf-8") if page_markdown_path(page_id).exists() else ""
    rendered_html = page_rendered_path(page_id).read_text(encoding="utf-8") if page_rendered_path(page_id).exists() else ""
    notes = read_json(page_notes_path(page_id), {})
    return {
        "meta": meta,
        "markdown": markdown,
        "renderedHtml": rendered_html,
        "notes": notes,
    }


def create_page_from_markdown(title: str, category_path: str, markdown: str, file_name: str):
    page_id = safe_page_id(title or file_name or "page")
    folder = page_dir(page_id)
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "assets").mkdir(exist_ok=True)
    (folder / "assets" / ".keep").write_text("", encoding="utf-8")

    created_at = now_iso()
    final_title = title or extract_title(markdown, file_name or "未命名页面")
    meta = {
        "id": page_id,
        "title": final_title,
        "categoryPath": normalize_category_path(category_path),
        "summary": extract_summary(markdown),
        "createdAt": created_at,
        "updatedAt": created_at,
        "order": 999,
        "sourceFileName": file_name or "",
        "assetBasePath": f"/content/pages/{page_id}/assets/",
        "sourceType": "markdown",
    }

    page_markdown_path(page_id).write_text(markdown, encoding="utf-8")
    write_json(page_notes_path(page_id), {})
    write_json(page_meta_path(page_id), meta)
    ensure_category_exists(meta["categoryPath"])
    return meta


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        reader = PdfReader(str(pdf_path))
    except Exception:
        return ""

    chunks = []
    for page in reader.pages[:80]:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text:
            chunks.append(text.strip())

    text = "\n\n".join(chunk for chunk in chunks if chunk)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()[:30000]


def html_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_pdf_markdown(title: str, pdf_asset_path: str, extracted_text: str, file_name: str) -> str:
    safe_text = html_escape(extracted_text).strip()
    extracted_section = (
        safe_text
        if safe_text
        else "暂时没有从这份 PDF 中提取出可用文本。你仍然可以通过上方的内嵌预览查看原文件。"
    )
    return (
        f"# {title}\n\n"
        f"> 这是一份通过 PDF 导入的学习文档。\n"
        f"> 原始文件：`{file_name or 'source.pdf'}`\n\n"
        f"[打开原始 PDF]({pdf_asset_path})\n\n"
        f'<object data="{pdf_asset_path}" type="application/pdf" width="100%" height="860">\n'
        f"<p>当前浏览器无法直接显示 PDF，请使用上方链接打开原文件。</p>\n"
        f"</object>\n\n"
        "## 提取文本\n\n"
        "下面的文本由系统从 PDF 中提取，用于搜索、选词标注、批注与 AI 解释。排版可能与原文略有差异。\n\n"
        f"{extracted_section}\n"
    )


def create_page_from_pdf(title: str, category_path: str, pdf_base64: str, file_name: str):
    page_id = safe_page_id(title or file_name or "pdf")
    folder = page_dir(page_id)
    folder.mkdir(parents=True, exist_ok=False)
    page_assets_dir(page_id).mkdir(exist_ok=True)
    (page_assets_dir(page_id) / ".keep").write_text("", encoding="utf-8")

    pdf_bytes = base64.b64decode(pdf_base64.encode("utf-8"))
    pdf_path = page_pdf_asset_path(page_id)
    pdf_path.write_bytes(pdf_bytes)

    extracted_text = extract_pdf_text(pdf_path)
    page_extracted_text_path(page_id).write_text(extracted_text, encoding="utf-8")

    created_at = now_iso()
    final_title = title.strip() if title.strip() else Path(file_name or "未命名 PDF").stem
    asset_web_path = f"/content/pages/{page_id}/assets/source.pdf"
    markdown = build_pdf_markdown(final_title, asset_web_path, extracted_text, file_name)
    meta = {
        "id": page_id,
        "title": final_title,
        "categoryPath": normalize_category_path(category_path),
        "summary": extract_summary(extracted_text or f"导入的 PDF 文档：{final_title}"),
        "createdAt": created_at,
        "updatedAt": created_at,
        "order": 999,
        "sourceFileName": file_name or "",
        "assetBasePath": f"/content/pages/{page_id}/assets/",
        "sourceType": "pdf",
    }

    page_markdown_path(page_id).write_text(markdown, encoding="utf-8")
    write_json(page_notes_path(page_id), {})
    write_json(page_meta_path(page_id), meta)
    ensure_category_exists(meta["categoryPath"])
    return meta


def ensure_category_exists(category_path: str) -> None:
    categories = read_json(CATEGORIES_FILE, [])
    normalized = normalize_category_path(category_path)
    if normalized not in categories:
        categories.append(normalized)
        write_json(CATEGORIES_FILE, categories)


def update_page_rendered(page_id: str, rendered_html: str, notes):
    meta = load_page_meta(page_id)
    if not meta:
        return None

    page_rendered_path(page_id).write_text(rendered_html or "", encoding="utf-8")
    write_json(page_notes_path(page_id), notes or {})
    meta["updatedAt"] = now_iso()
    write_json(page_meta_path(page_id), meta)
    return meta


def build_llm_messages(page_detail: dict, selected_text: str, question: str, llm_settings: dict):
    page_meta = page_detail["meta"]
    context_markdown = page_detail["markdown"][:12000]
    system_prompt = llm_settings.get("systemPrompt") or default_settings()["llm"]["systemPrompt"]
    user_prompt = (
        f"当前文章标题：{page_meta['title']}\n"
        f"当前文章分类：{page_meta['categoryPath']}\n"
        f"选中的词或短语：{selected_text}\n"
        f"用户问题：{question}\n\n"
        "请先解释该词或短语在本文中的具体含义，再说明它在上下文中的作用。"
        "如果本文没有给出充分定义，请明确说明，然后补充必要的一般性解释。"
        "表达尽量清晰、准确、适合初学者。\n\n"
        f"文章内容如下：\n{context_markdown}"
    )
    return system_prompt, user_prompt


def resolve_llm_endpoint(endpoint: str) -> tuple[str, str]:
    normalized = str(endpoint or "").strip().rstrip("/")
    if not normalized:
        return "", "chat"

    lowered = normalized.lower()
    if lowered.endswith("/chat/completions"):
        return normalized, "chat"
    if lowered.endswith("/responses"):
        return normalized, "responses"

    parsed = urlparse(normalized)
    path = parsed.path.rstrip("/")
    if path.endswith("/v1"):
        return f"{normalized}/chat/completions", "chat"

    return normalized, "chat"


def extract_llm_text(response_data: dict) -> str:
    if isinstance(response_data, dict):
        choices = response_data.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {})
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                texts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        texts.append(item.get("text", ""))
                return "\n".join(texts).strip()

        if isinstance(response_data.get("output_text"), str):
            return response_data["output_text"].strip()

        output = response_data.get("output")
        if isinstance(output, list):
            texts = []
            for item in output:
                for content in item.get("content", []):
                    if isinstance(content, dict) and isinstance(content.get("text"), str):
                        texts.append(content["text"])
            if texts:
                return "\n".join(texts).strip()

    return ""


def call_llm(page_detail: dict, selected_text: str, question: str) -> str:
    settings = load_settings()
    llm = settings["llm"]

    if not llm.get("enabled"):
        raise ValueError("LLM 功能未启用，请先在设置中开启并填写配置。")
    if not llm.get("endpoint"):
        raise ValueError("LLM endpoint 未配置。")
    if not llm.get("model"):
        raise ValueError("LLM model 未配置。")
    if not llm.get("apiKey"):
        raise ValueError("LLM API Key 未配置。")

    system_prompt, user_prompt = build_llm_messages(page_detail, selected_text, question, llm)
    endpoint, endpoint_kind = resolve_llm_endpoint(llm["endpoint"])
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {llm['apiKey']}",
    }

    if endpoint_kind == "responses":
        payload = {
            "model": llm["model"],
            "temperature": llm.get("temperature", 0.2),
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
    else:
        payload = {
            "model": llm["model"],
            "temperature": llm.get("temperature", 0.2),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="ignore")
        raise ValueError(f"LLM 请求失败: HTTP {exc.code} {error_text}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"LLM 请求失败: {exc.reason}") from exc

    text = extract_llm_text(data)
    if not text:
        raise ValueError("LLM 返回中没有可解析的文本内容。")
    return text


class BlogHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        print("[blog]", format % args)

    def send_json(self, status: int, payload) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") if raw else "{}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/bootstrap":
            self.send_json(200, load_manifest())
            return

        if path == "/api/settings":
            self.send_json(200, load_settings())
            return

        if path.startswith("/api/pages/"):
            page_id = path.removeprefix("/api/pages/").strip("/")
            detail = load_page_detail(page_id)
            if not detail:
                self.send_json(404, {"error": "Page not found."})
                return
            self.send_json(200, detail)
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        try:
            if path == "/api/upload-markdown":
                payload = self.read_json_body()
                markdown = payload.get("markdown", "")
                title = payload.get("title", "").strip()
                category_path = payload.get("categoryPath") or "科研学习/初学手册"
                meta = create_page_from_markdown(title, category_path, markdown, payload.get("fileName", ""))
                self.send_json(201, {"page": meta})
                return

            if path == "/api/upload-pdf":
                payload = self.read_json_body()
                pdf_base64 = payload.get("pdfBase64", "").strip()
                title = payload.get("title", "").strip()
                category_path = payload.get("categoryPath") or "科研学习/初学手册"
                if not pdf_base64:
                    self.send_json(400, {"error": "PDF file content is required."})
                    return
                meta = create_page_from_pdf(title, category_path, pdf_base64, payload.get("fileName", "source.pdf"))
                self.send_json(201, {"page": meta})
                return

            if path == "/api/categories":
                payload = self.read_json_body()
                category_path = normalize_category_path(payload.get("categoryPath", ""))
                ensure_category_exists(category_path)
                self.send_json(200, {"categoryPath": category_path})
                return

            if path == "/api/settings":
                payload = self.read_json_body()
                settings = save_settings(payload)
                self.send_json(200, {"settings": settings})
                return

            if path == "/api/llm-explain":
                payload = self.read_json_body()
                page_id = payload.get("pageId", "").strip()
                selected_text = payload.get("selectedText", "").strip()
                question = payload.get("question", "").strip()
                page_detail = load_page_detail(page_id)
                if not page_detail:
                    self.send_json(404, {"error": "Page not found."})
                    return
                if not selected_text:
                    self.send_json(400, {"error": "Selected text is required."})
                    return
                if not question:
                    question = f"解释“{selected_text}”的含义。"

                answer = call_llm(page_detail, selected_text, question)
                self.send_json(200, {"answer": answer})
                return

            if path.startswith("/api/pages/") and path.endswith("/save"):
                page_id = path.removeprefix("/api/pages/").removesuffix("/save").strip("/")
                payload = self.read_json_body()
                meta = update_page_rendered(page_id, payload.get("renderedHtml", ""), payload.get("notes", {}))
                if not meta:
                    self.send_json(404, {"error": "Page not found."})
                    return
                self.send_json(200, {"page": meta})
                return

            self.send_json(404, {"error": "Unknown API endpoint."})
        except FileExistsError:
            self.send_json(409, {"error": "Page folder already exists."})
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:  # pragma: no cover
            self.send_json(500, {"error": str(exc)})


def parse_args():
    parser = argparse.ArgumentParser(description="Serve Minyako blog locally.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind. Default: 8876")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_content_layout()
    os.chdir(BASE_DIR)
    with ThreadingHTTPServer((args.host, args.port), BlogHandler) as server:
        print("Minyako blog server is running.")
        print(f"Open this URL in your browser: http://{args.host}:{args.port}/index.html")
        print("Content root:", CONTENT_DIR)
        print("Press Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
