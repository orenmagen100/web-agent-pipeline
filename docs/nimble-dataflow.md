# How a web-data platform like Nimble moves data

These diagrams show how a platform like Nimble *plausibly* works, built from public product
descriptions (Web API, scraping infrastructure, Jobs, Web Search Agents, SDK/MCP). They are
**not** Nimble's internal architecture. Use them to reason and ask good questions, and check
the product names against nimbleway.com before the interview.

Each box marked ★ is something this repo's prototype does in miniature.

---

## 0. The whole platform on one page

Every product sits on the same core: **route → fetch through proxies → check → parse → deliver.**
The products differ in *how requests come in* and *where results go*.

```mermaid
flowchart TB
  subgraph Entry["How requests come in"]
    API["Web API<br/>Extract · SERP · E-commerce · Map · Crawl"]
    JOBS["Jobs / Scheduler<br/>recurring collection"]
    AGENT["Web Search Agents<br/>a question in, a table out"]
    MCP["SDKs and MCP server<br/>AI agents call the tools"]
  end

  subgraph Core["Shared core"]
    GW["API gateway<br/>auth · quotas · billing"]
    ROUTER["Router<br/>per-domain strategy"]
    FETCH["Fetch tier<br/>HTTP · unblocker · AI browser ★"]
    PROXY["Proxy network<br/>datacenter · residential · mobile · geo"]
    CHECK["Validation<br/>blocked? partial? ★"]
    PARSE["Parsing<br/>templates ★ · AI parsing · Markdown ★"]
  end

  subgraph Out["Where results go"]
    SYNC["Synchronous JSON reply ★"]
    STORE["Batch delivery<br/>S3 · Snowflake · Databricks · webhook"]
    LLM["Straight into an LLM context"]
  end

  WEB[("Target websites")]

  API --> GW
  JOBS --> GW
  AGENT --> GW
  MCP --> GW
  GW --> ROUTER --> FETCH --> PROXY --> WEB
  WEB --> FETCH --> CHECK
  CHECK -- "blocked or partial: escalate" --> ROUTER
  CHECK -- ok --> PARSE
  PARSE --> SYNC
  PARSE --> STORE
  PARSE --> LLM
```

---

## 1. Web API: one real-time request (Extract)

A customer sends one URL and waits a few seconds for the answer. The key idea is the
**escalation loop**: try the cheap way first and step up only when validation says it failed.

```mermaid
sequenceDiagram
  autonumber
  participant C as Customer / AI agent
  participant GW as API gateway
  participant R as Router
  participant K as Cache
  participant F as Fetch worker
  participant P as Proxy network
  participant S as Target site
  participant V as Validator
  participant X as Parser

  C->>GW: POST /extract {url, render, country, format, parser}
  GW->>GW: auth, rate limit, meter usage
  GW->>R: request
  R->>K: fresh copy of this URL for this country?
  alt cache hit
    K-->>R: cached result
  else cache miss
    R->>R: look up domain strategy (which tier worked last time)
    R->>F: fetch with tier 1 (e.g. plain HTTP + datacenter IP)
    F->>P: pick IP (geo, reputation, sticky session?)
    P->>S: HTTP request with a matching browser fingerprint
    S-->>F: HTML (maybe a CAPTCHA, or a page with a missing price)
    F->>V: check the content, not just the status code ★
    alt blocked or partial
      V-->>R: failure + reason
      R->>F: retry on next tier (residential IP, then full browser render)
    else ok
      V->>X: page
      X->>X: template / AI parsing → JSON, or clean → Markdown ★
      X-->>K: store with a TTL
    end
  end
  R-->>C: {status, data, markdown, metrics} ★
```

**Things to note:**
- The **router's per-domain memory** is what makes this cheap at scale: most domains settle on one tier.
- **Validation decides the retry**, not the HTTP status. A 200 OK CAPTCHA page must still count as a failure.
- Billing usually depends on the tier used (rendering and residential bandwidth cost the most).

---

## 2. Inside the routing and proxy layer

This is where most of the hard engineering lives: picking an IP and a browser profile that
look consistent, and learning from every result.

```mermaid
flowchart LR
  REQ["Request<br/>domain · country · render?"] --> STRAT["Domain strategy store<br/>best tier · block rate · cost"]
  STRAT --> SEL["Selector<br/>multi-armed bandit:<br/>success per dollar"]

  subgraph Pool["Proxy pool"]
    DC["Datacenter IPs<br/>cheap · low trust"]
    RES["Residential IPs<br/>expensive · high trust"]
    MOB["Mobile IPs<br/>most trust"]
  end

  subgraph Prof["Fingerprint profiles"]
    FP["TLS / HTTP2 signature<br/>user agent · fonts · WebGL<br/>timezone and language match IP geo"]
  end

  SEL --> Pool
  SEL --> Prof
  Pool --> FETCH["Fetch / browser worker"]
  Prof --> FETCH
  FETCH --> SITE[("Target site")]
  SITE --> RESULT["Result<br/>ok · blocked · partial · latency"]
  RESULT -- "update scores" --> STRAT
  RESULT -- "burned IP: cool down" --> Pool
  RESULT -- "detected profile: retire" --> Prof
```

**The feedback loop is the product.** Every result updates three things: the domain's
strategy, the IP's reputation, and the fingerprint profile's health.

---

## 3. SERP and E-commerce APIs: specialized parsers

These are the same pipeline with a **maintained parser per site** (Google, Amazon, Walmart…)
and a fixed output schema. The customer asks for a query or product ID, not a URL.

```mermaid
flowchart LR
  Q["Query or product ID<br/>'running shoes', ASIN, country"] --> BUILD["URL builder<br/>site-specific search / product URL"]
  BUILD --> CORE["Shared core<br/>route → proxy → fetch → validate"]
  CORE --> PARSER["Site parser<br/>maintained by the platform"]
  PARSER --> SCHEMA["Fixed schema<br/>organic results · ads · price · rating · stock"]
  PARSER -. "parse failures spike" .-> DRIFT["Drift monitor<br/>site changed its layout"]
  DRIFT -. "alert, regenerate parser" .-> PARSER
  SCHEMA --> OUT["JSON to customer"]
```

The value to the customer: they never maintain selectors. The platform absorbs layout changes.

---

## 4. Jobs / Scheduler: recurring batch collection

For "every morning, scrape these 200,000 product pages and drop the results in Snowflake".
Here throughput and cost matter more than latency.

```mermaid
flowchart TB
  DEF["Job definition<br/>URL list or sitemap · schedule (cron) · parser · destination"] --> SCHED["Scheduler<br/>fires at the set time"]
  SCHED --> SPLIT["Splitter<br/>one task per URL · dedupe · priority"]
  SPLIT --> Q[["Queue (e.g. Kafka / SQS)<br/>per-domain partitions"]]
  Q --> W1["Worker"]
  Q --> W2["Worker"]
  Q --> W3["Worker ... autoscaled"]
  W1 --> CORE["Shared core<br/>route → proxy → fetch → validate → parse"]
  W2 --> CORE
  W3 --> CORE
  CORE -- "failed: retry later with backoff" --> Q
  CORE -- "ok / partial" --> RES[("Results store")]
  RES --> DEL["Delivery<br/>S3 · Snowflake · Databricks · webhook"]
  RES --> MON["Job report<br/>success rate · p50/p95 latency · failures by reason · partial rate per parser"]
  MON -. "partial rate jumps" .-> ALERT["Template drift alert"]
```

**Things to note:**
- **Per-domain partitions** let you enforce politeness (rate limits per site) and stop one slow site from blocking others.
- Failed tasks go **back on the queue** with growing delays instead of blocking the job.
- The job report is like the batch summary planned for this repo's Phase 3.

---

## 5. Map and Crawl: discovering URLs

Before you can scrape a site, you need its URLs.

```mermaid
flowchart LR
  SEED["Seed URL / domain"] --> MAP["Map<br/>read sitemap.xml + robots.txt"]
  SEED --> CRAWL["Crawl<br/>follow links within rules: depth, URL patterns"]
  MAP --> FRONTIER[["URL frontier<br/>dedupe · normalize · prioritize"]]
  CRAWL --> FRONTIER
  FRONTIER --> CORE["Shared core<br/>fetch each page"]
  CORE -- "new links found" --> FRONTIER
  CORE --> OUT["Pages as Markdown or JSON<br/>or a URL list to feed a Job"]
```

---

## 6. Where LLMs fit (three different jobs)

LLMs are expensive per call, so the design question is always **"LLM once, or LLM every page?"**

```mermaid
flowchart TB
  subgraph A["A. LLM builds the parser once (cheap at scale)"]
    A1["New site: sample HTML, trimmed"] --> A2["LLM proposes CSS selectors<br/>for the target schema"]
    A2 --> A3["Template saved"]
    A3 --> A4["Deterministic extraction<br/>on millions of pages ★"]
    A4 -. "validation partial rate rises" .-> A1
  end

  subgraph B["B. LLM parses each page (flexible, costly)"]
    B1["Cleaned Markdown ★<br/>~80% fewer tokens than HTML"] --> B2["LLM extracts fields<br/>for a schema given at request time"]
    B2 --> B3["JSON + schema validation"]
  end

  subgraph C["C. Web Search Agents (LLM plans the research)"]
    C1["Question:<br/>'top 20 CRM tools with pricing'"] --> C2["Plan: queries and sources"]
    C2 --> C3["SERP API → candidate URLs"]
    C3 --> C4["Extract API → Markdown per page"]
    C4 --> C5["LLM reads, dedupes,<br/>fills a table schema"]
    C5 --> C6["Structured table<br/>with source URLs"]
  end
```

- **A** is the cost win: one LLM call per site layout, not per page. That's Phase 4 of this repo's plan.
- **B** handles new or one-off sites; Markdown conversion is what keeps the token bill down.
- **C** chains the other products together: search, then extract, then synthesize. The agent returns a table instead of raw pages, which saves the customer's own LLM tokens.

---

## 7. How AI agents call it (SDK and MCP)

```mermaid
sequenceDiagram
  participant U as User
  participant AG as AI agent (e.g. Claude)
  participant M as MCP server / SDK
  participant N as Web data platform

  U->>AG: "Compare prices of these 3 laptops"
  AG->>M: tool call: search("laptop X price")
  M->>N: SERP API
  N-->>AG: result URLs
  AG->>M: tool call: extract(url, format=markdown)
  M->>N: Extract API (route, proxy, render, validate)
  N-->>AG: clean Markdown, a few hundred tokens instead of ~50k of HTML
  AG-->>U: comparison table with sources
```

---

## Map of this repo onto the platform

| Platform piece | This repo | Not built (talking points) |
| --- | --- | --- |
| Fetch tier | `src/fetch/fetcher.ts`: Playwright, JavaScript on/off, waitFor, retries | Tier escalation, HTTP-first fetching |
| Proxy network and fingerprints | none | Pool, scoring, geo, profile consistency |
| Validation | `src/validate/checks.ts`: blocked / partial / failed / ok | Soft-block cross-checks, history comparison |
| Parsing | `src/extract/templates/product.ts`, `src/clean/` | LLM template generation, per-page LLM parsing |
| Web API | `server.ts` → `/api/scrape` | Auth, quotas, billing, cache |
| Jobs | none (Phase 3 plan) | Scheduler, queue, delivery, drift alerts |
| Agents and MCP | none | Search → extract → synthesize |
