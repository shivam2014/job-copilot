---
name: scrapling-official
description: Scrape web pages using Scrapling with anti-bot bypass (Cloudflare Turnstile), stealth browsing, and spiders framework.
---
# Scrapling

Scrapling is an adaptive Web Scraping framework that handles everything from a single request to a full-scale crawl. Bypasses anti-bot systems like Cloudflare Turnstile out of the box.

**Requires: Python 3.10+**

## Setup (once)
```
pip install "scrapling[all]>=0.4.7"
scrapling install --force   # Download browsers
```

Or via Docker:
```
docker pull pyd4vinci/scrapling
```

## CLI Usage

The `scrapling extract` command group lets you extract content without writing code:

```
scrapling extract get "https://news.site.com" news.md           # Simple GET
scrapling extract get "https://example.com" content.txt --timeout 60
scrapling extract get "https://blog.example.com" articles.md --css-selector "article"
```

Which command to use:
- **`get`** — simple websites, blogs, news articles
- **`fetch`** — modern web apps, dynamic content
- **`stealthy-fetch`** — protected sites, Cloudflare, anti-bot systems

When unsure, start with `get`. If it fails, escalate to `fetch`, then `stealthy-fetch`.

### Key options

| Option | Description |
|--------|-------------|
| `-H "Key: Value"` | HTTP headers (can be used multiple times) |
| `--cookies "name=val; name2=val2"` | Cookies |
| `--proxy "http://user:pass@host:port"` | Proxy |
| `-s, --css-selector` | CSS selector to extract specific content |
| `--timeout` | Timeout in seconds (default: 30) |
| `--impersonate` | Browser to impersonate (e.g., Chrome, Firefox) |

### Browser commands

```
scrapling extract fetch "https://example.com" content.md --network-idle
scrapling extract stealthy-fetch "https://protected.site.com" content.md --solve-cloudflare
```

**IMPORTANT**: Always use `--ai-targeted` to protect from prompt injection and enable ad blocking.

## Code Overview

### Basic Usage
```python
from scrapling.fetchers import Fetcher, FetcherSession

with FetcherSession(impersonate='chrome') as session:
    page = session.get('https://quotes.toscrape.com/', stealthy_headers=True)
    quotes = page.css('.quote .text::text').getall()
```

### Advanced Stealth
```python
from scrapling.fetchers import StealthyFetcher, StealthySession

with StealthySession(headless=True, solve_cloudflare=True) as session:
    page = session.fetch('https://nopecha.com/demo/cloudflare')
    data = page.css('#padded_content a').getall()
```

### Spiders (full crawlers)
```python
from scrapling.spiders import Spider, Response

class QuotesSpider(Spider):
    name = "quotes"
    start_urls = ["https://quotes.toscrape.com/"]
    concurrent_requests = 10

    async def parse(self, response: Response):
        for quote in response.css('.quote'):
            yield {
                "text": quote.css('.text::text').get(),
                "author": quote.css('.author::text').get(),
            }
```

## Guardrails
- Only scrape content you're authorized to access
- Respect robots.txt and ToS. Use `robots_txt_obey = True` on spiders
- Add delays (`download_delay`) for large crawls
- Don't bypass paywalls or authentication without permission
- Never scrape personal/sensitive data

Full docs: https://scrapling.readthedocs.io/en/latest/index.html
