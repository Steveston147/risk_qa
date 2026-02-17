import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_WEBHOOK_URL = "https://stevston.app.n8n.cloud/webhook/risk";

type ApiResponse =
  | {
      answer?: string;
      result?: string;
      text?: string;
      message?: string;
      output?: string;
      data?: unknown;
    }
  | string
  | unknown;

type HistoryItem = {
  id: string;
  at: string; // ISO
  question: string;
  answer: string;
  pinned?: boolean;
  raw?: unknown;
};

type Toast = { id: string; text: string };

function safeId() {
  try {
    // @ts-ignore
    const uuid = crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // ignore
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pickAnswer(payload: ApiResponse): { answer: string; raw: unknown } {
  if (typeof payload === "string") return { answer: payload, raw: payload };

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const keys = ["answer", "result", "text", "message", "output"] as const;

    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return { answer: v.trim(), raw: payload };
    }

    const data = obj["data"];
    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      for (const k of keys) {
        const v = dataObj[k];
        if (typeof v === "string" && v.trim()) return { answer: v.trim(), raw: payload };
      }
    }

    try {
      return { answer: JSON.stringify(payload, null, 2), raw: payload };
    } catch {
      return { answer: String(payload), raw: payload };
    }
  }

  return { answer: String(payload), raw: payload };
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function clamp(s: string, n: number) {
  const t = s.trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

/**
 * Mini Markdown renderer (safe: no dangerouslySetInnerHTML)
 * Supported:
 * - #, ## headings
 * - - list items
 * - ``` code blocks
 * - **bold**
 * - `inline code`
 * - [text](url)
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;

  const pushText = (t: string) => {
    if (!t) return;
    nodes.push(t);
  };

  while (i < text.length) {
    // link [text](url)
    if (text[i] === "[" ) {
      const close = text.indexOf("]", i + 1);
      const openParen = close >= 0 ? text.indexOf("(", close + 1) : -1;
      const closeParen = openParen >= 0 ? text.indexOf(")", openParen + 1) : -1;
      if (close >= 0 && openParen === close + 1 && closeParen >= 0) {
        const label = text.slice(i + 1, close);
        const url = text.slice(openParen + 1, closeParen);
        if (url.startsWith("http://") || url.startsWith("https://")) {
          nodes.push(
            <a key={`a_${i}`} href={url} target="_blank" rel="noreferrer" style={styles.link}>
              {label || url}
            </a>
          );
          i = closeParen + 1;
          continue;
        }
      }
    }

    // bold **...**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end >= 0) {
        const inside = text.slice(i + 2, end);
        nodes.push(
          <strong key={`b_${i}`} style={styles.strong}>
            {inside}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }

    // inline code `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end >= 0) {
        const inside = text.slice(i + 1, end);
        nodes.push(
          <code key={`c_${i}`} style={styles.inlineCode}>
            {inside}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    // plain char
    pushText(text[i]);
    i += 1;
  }

  return nodes;
}

function MarkdownView({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];

  let inCode = false;
  let codeBuf: string[] = [];
  let listBuf: string[] = [];

  const flushList = (keySeed: number) => {
    if (listBuf.length === 0) return;
    const items = listBuf;
    listBuf = [];
    blocks.push(
      <ul key={`ul_${keySeed}`} style={styles.ul}>
        {items.map((li, idx) => (
          <li key={`li_${keySeed}_${idx}`} style={styles.li}>
            <span style={styles.liDot} />
            <span>{renderInline(li)}</span>
          </li>
        ))}
      </ul>
    );
  };

  const flushCode = (keySeed: number) => {
    if (codeBuf.length === 0) return;
    const code = codeBuf.join("\n");
    codeBuf = [];
    blocks.push(
      <pre key={`pre_${keySeed}`} style={styles.pre}>
        <code style={styles.preCode}>{code}</code>
      </pre>
    );
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.replace(/\r$/, "");

    if (line.trim().startsWith("```")) {
      if (!inCode) {
        flushList(idx);
        inCode = true;
        codeBuf = [];
      } else {
        inCode = false;
        flushCode(idx);
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // list item
    const mList = line.match(/^\s*[-*]\s+(.*)$/);
    if (mList) {
      listBuf.push(mList[1]);
      continue;
    } else {
      flushList(idx);
    }

    // heading
    const h1 = line.match(/^\s*#\s+(.*)$/);
    const h2 = line.match(/^\s*##\s+(.*)$/);
    if (h1) {
      blocks.push(
        <div key={`h1_${idx}`} style={styles.mdH1}>
          {renderInline(h1[1])}
        </div>
      );
      continue;
    }
    if (h2) {
      blocks.push(
        <div key={`h2_${idx}`} style={styles.mdH2}>
          {renderInline(h2[1])}
        </div>
      );
      continue;
    }

    // blank
    if (!line.trim()) {
      blocks.push(<div key={`sp_${idx}`} style={{ height: 10 }} />);
      continue;
    }

    // paragraph
    blocks.push(
      <div key={`p_${idx}`} style={styles.p}>
        {renderInline(line)}
      </div>
    );
  }

  // end flush
  flushList(lines.length + 1);
  if (inCode) flushCode(lines.length + 2);

  return <div>{blocks}</div>;
}

export default function App() {
  const envUrl =
    (import.meta as any)?.env?.VITE_N8N_WEBHOOK_URL ||
    (import.meta as any)?.env?.VITE_WEBHOOK_URL;

  const [webhookUrl, setWebhookUrl] = useState<string>(() => {
    const fromEnv = (envUrl as string) || "";
    if (fromEnv) return fromEnv;
    try {
      const saved = localStorage.getItem("risk_qa_webhook_url_v1");
      if (saved) return saved;
    } catch {
      // ignore
    }
    return DEFAULT_WEBHOOK_URL;
  });

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"Idle" | "Sending" | "Ready">("Idle");
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem("risk_qa_history_v2");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoryItem[];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 50);
    } catch {
      return [];
    }
  });

  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState(webhookUrl);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = useMemo(() => q.trim().length > 0 && !loading, [q, loading]);

  const visibleHistory = useMemo(() => {
    const s = search.trim().toLowerCase();
    const sorted = [...history].sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.at.localeCompare(a.at);
    });
    if (!s) return sorted;

    return sorted.filter((h) => {
      const hay = `${h.question}\n${h.answer}`.toLowerCase();
      return hay.includes(s);
    });
  }, [history, search]);

  const pinnedCount = useMemo(() => history.filter((h) => !!h.pinned).length, [history]);

  useEffect(() => {
    try {
      localStorage.setItem("risk_qa_history_v2", JSON.stringify(history.slice(0, 50)));
    } catch {
      // ignore
    }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem("risk_qa_webhook_url_v1", webhookUrl);
    } catch {
      // ignore
    }
  }, [webhookUrl]);

  useEffect(() => {
    setDraftUrl(webhookUrl);
  }, [settingsOpen, webhookUrl]);

  function toast(text: string) {
    const id = safeId();
    setToasts((prev) => [{ id, text }, ...prev].slice(0, 3));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      toast("コピーできませんでした（ブラウザ権限をご確認ください）");
    }
  }

  async function send() {
    const question = q.trim();
    if (!question || loading) return;

    setLoading(true);
    setStatus("Sending");
    setError(null);

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const contentType = res.headers.get("content-type") || "";
      let payload: ApiResponse;

      if (contentType.includes("application/json")) {
        payload = await res.json();
      } else {
        const txt = await res.text();
        try {
          payload = JSON.parse(txt);
        } catch {
          payload = txt;
        }
      }

      if (!res.ok) {
        const { answer } = pickAnswer(payload);
        throw new Error(answer || `Request failed: ${res.status}`);
      }

      const { answer, raw } = pickAnswer(payload);

      const item: HistoryItem = {
        id: safeId(),
        at: new Date().toISOString(),
        question,
        answer: answer || "(No answer returned)",
        raw,
      };

      setHistory((prev) => [item, ...prev].slice(0, 50));
      setQ("");
      setStatus("Ready");
      toast("回答を受け取りました");

      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      setStatus("Idle");
    } finally {
      setLoading(false);
      window.setTimeout(() => setStatus("Idle"), 1200);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) {
      e.preventDefault();
      void send();
    }
  }

  function clearAll() {
    setHistory([]);
    setSearch("");
    setError(null);
    setQ("");
    toast("履歴をクリアしました");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function togglePin(id: string) {
    setHistory((prev) =>
      prev.map((h) => (h.id === id ? { ...h, pinned: !h.pinned } : h))
    );
  }

  function removeOne(id: string) {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }

  function applySettings() {
    const u = draftUrl.trim();
    if (!u.startsWith("https://")) {
      toast("Webhook URL は https:// から始めてください");
      return;
    }
    setWebhookUrl(u);
    setSettingsOpen(false);
    toast("Webhook URL を保存しました");
  }

  return (
    <div style={styles.page}>
      <div style={styles.bgGlow1} />
      <div style={styles.bgGlow2} />

      <div style={styles.shell}>
        <header style={styles.topbar}>
          <div style={styles.brand}>
            <div style={styles.brandMark} />
            <div>
              <div style={styles.brandTitle}>留学サポートデスク</div>
              <div style={styles.brandSub}>Risk Q&amp;A Console</div>
            </div>
          </div>

          <div style={styles.topActions}>
            <div style={styles.statusPill}>
              <span
                style={{
                  ...styles.statusDot,
                  ...(status === "Sending"
                    ? styles.dotSending
                    : status === "Ready"
                    ? styles.dotReady
                    : styles.dotIdle),
                }}
              />
              <span style={{ fontWeight: 800 }}>{status}</span>
            </div>

            <button style={styles.iconBtn} onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙︎
            </button>
          </div>
        </header>

        <div style={styles.hero}>
          <div style={styles.heroLeft}>
            <div style={styles.heroKicker}>ASK</div>
            <h1 style={styles.h1}>Risk Q&amp;A</h1>
            <div style={styles.heroDesc}>
              Reactは入口だけ。処理はn8n（Webhook）で実行します。社内で“それっぽい”見た目に寄せた版。
            </div>
          </div>

          <div style={styles.heroRight}>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>Pinned</div>
              <div style={styles.metricValue}>{pinnedCount}</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>History</div>
              <div style={styles.metricValue}>{history.length}</div>
            </div>
          </div>
        </div>

        <main style={styles.main}>
          {/* Left: Ask */}
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <div style={styles.panelTitle}>質問</div>
                <div style={styles.panelMeta}>POST /webhook/risk</div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  style={{ ...styles.smallBtn }}
                  onClick={() => copyText(webhookUrl, "Webhook URLをコピーしました")}
                  title="Copy webhook URL"
                >
                  URLコピー
                </button>
                <button
                  style={{ ...styles.smallBtn, ...styles.smallBtnGhost }}
                  onClick={() => {
                    setQ("");
                    setError(null);
                    setTimeout(() => textareaRef.current?.focus(), 0);
                  }}
                >
                  リセット
                </button>
              </div>
            </div>

            <div style={styles.textareaWrap}>
              <textarea
                ref={textareaRef}
                style={styles.textarea}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="例：長期派遣2名体制に切り替える場合の法的リスクと実務上の注意点は？"
                rows={8}
              />
              <div style={styles.hintRow}>
                <div style={styles.hintLeft}>Ctrl+Enterで送信</div>
                <div style={styles.hintRight}>
                  Webhook: <span style={styles.mono}>{webhookUrl}</span>
                </div>
              </div>
            </div>

            <div style={styles.actionRow}>
              <button
                style={{
                  ...styles.primaryBtn,
                  ...(canSend ? null : styles.btnDisabled),
                }}
                onClick={() => void send()}
                disabled={!canSend}
              >
                {loading ? "送信中..." : "送信"}
              </button>

              <button style={styles.secondaryBtn} onClick={clearAll} disabled={loading}>
                履歴クリア
              </button>

              <button
                style={styles.secondaryBtn}
                onClick={() => copyText(q || "", "質問をコピーしました")}
                disabled={!q.trim()}
              >
                質問コピー
              </button>
            </div>

            {error && (
              <div style={styles.errorCard}>
                <div style={styles.errorTitle}>エラー</div>
                <div style={styles.errorText}>{error}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    style={styles.smallBtn}
                    onClick={() => {
                      setError(null);
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                  >
                    閉じる
                  </button>
                  <button style={styles.smallBtn} onClick={() => void send()} disabled={!canSend}>
                    再試行
                  </button>
                  <button
                    style={styles.smallBtn}
                    onClick={() => copyText(error, "エラー内容をコピーしました")}
                  >
                    エラーコピー
                  </button>
                </div>
              </div>
            )}

            <div style={styles.securityNote}>
              ※ APIキー等の機密は n8n 側にのみ保持（ブラウザには置きません）
            </div>
          </section>

          {/* Right: History */}
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <div>
                <div style={styles.panelTitle}>履歴</div>
                <div style={styles.panelMeta}>最新50件 / 端末に保存</div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={styles.searchWrap}>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>🔎</span>
                  <input
                    style={styles.searchInput}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="検索（質問/回答）"
                  />
                </div>
              </div>
            </div>

            {visibleHistory.length === 0 ? (
              <div style={styles.empty}>
                まだ履歴がありません。左のフォームから質問を送ってください。
              </div>
            ) : (
              <div style={styles.list}>
                {visibleHistory.map((h, idx) => (
                  <div key={h.id} style={styles.item}>
                    <div style={styles.itemTop}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                        <button
                          style={{
                            ...styles.pinBtn,
                            ...(h.pinned ? styles.pinBtnOn : null),
                          }}
                          onClick={() => togglePin(h.id)}
                          title={h.pinned ? "Unpin" : "Pin"}
                        >
                          {h.pinned ? "★" : "☆"}
                        </button>

                        <div style={{ minWidth: 0 }}>
                          <div style={styles.itemQ}>{clamp(h.question, 140)}</div>
                          <div style={styles.itemTime}>
                            {formatTime(h.at)} {idx === 0 ? "・latest" : ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          style={styles.tinyBtn}
                          onClick={() => {
                            setQ(h.question);
                            setTimeout(() => textareaRef.current?.focus(), 0);
                            toast("質問を再利用しました");
                          }}
                        >
                          再利用
                        </button>

                        <button
                          style={styles.tinyBtn}
                          onClick={() => copyText(h.answer, "回答をコピーしました")}
                        >
                          回答コピー
                        </button>

                        <button
                          style={{ ...styles.tinyBtn, ...styles.tinyBtnDanger }}
                          onClick={() => removeOne(h.id)}
                          title="Remove"
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <details style={styles.itemDetails} open={idx === 0}>
                      <summary style={styles.itemSummary}>
                        <span style={{ opacity: 0.8, fontWeight: 800 }}>回答を表示</span>
                        <span style={{ opacity: 0.6, fontSize: 12 }}>（Markdown整形）</span>
                      </summary>

                      <div style={styles.answerBox}>
                        <MarkdownView text={h.answer} />
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <footer style={styles.footer}>
          <span style={styles.footerSmall}>© 留学サポートデスク</span>
        </footer>
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div style={styles.modalOverlay} onMouseDown={() => setSettingsOpen(false)}>
          <div style={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.4 }}>Settings</div>
              <button style={styles.iconBtn} onClick={() => setSettingsOpen(false)} title="Close">
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.fieldLabel}>n8n Webhook URL</div>
              <div style={styles.fieldHint}>
                例：{DEFAULT_WEBHOOK_URL}
              </div>
              <input
                style={styles.urlInput}
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://.../webhook/..."
              />

              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button style={styles.primaryBtn} onClick={applySettings}>
                  保存
                </button>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => {
                    setDraftUrl(DEFAULT_WEBHOOK_URL);
                    toast("デフォルトURLをセットしました");
                  }}
                >
                  デフォルトに戻す
                </button>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => copyText(draftUrl, "URLをコピーしました")}
                >
                  URLコピー
                </button>
              </div>

              <div style={styles.modalNote}>
                ※ ここで保存したURLは、この端末のブラウザにのみ保存されます（localStorage）。
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={styles.toastWrap}>
        {toasts.map((t) => (
          <div key={t.id} style={styles.toast}>
            <span style={{ opacity: 0.9 }}>✓</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 700px at 15% 10%, rgba(120,140,255,0.20), transparent 60%)," +
      "radial-gradient(900px 600px at 85% 25%, rgba(120,255,200,0.12), transparent 55%)," +
      "linear-gradient(180deg, #060914, #050711)",
    color: "#eaf0ff",
    padding: 24,
    boxSizing: "border-box",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
    position: "relative",
    overflowX: "hidden",
  },
  bgGlow1: {
    position: "fixed",
    inset: -200,
    background:
      "radial-gradient(700px 500px at 25% 20%, rgba(120,140,255,0.18), transparent 60%)",
    pointerEvents: "none",
    filter: "blur(0px)",
  },
  bgGlow2: {
    position: "fixed",
    inset: -200,
    background:
      "radial-gradient(700px 500px at 80% 35%, rgba(120,255,200,0.10), transparent 60%)",
    pointerEvents: "none",
    filter: "blur(0px)",
  },
  shell: {
    maxWidth: 1200,
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },
  topbar: {
    display: "flex",
    gap: 14,
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },
  brand: { display: "flex", gap: 12, alignItems: "center" },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background:
      "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(120,140,255,0.55) 45%, rgba(80,90,190,0.35) 75%, rgba(0,0,0,0.2))",
    boxShadow: "0 14px 40px rgba(120,140,255,0.18)",
  },
  brandTitle: { fontSize: 14, fontWeight: 900, letterSpacing: 0.2 },
  brandSub: { marginTop: 1, fontSize: 12, opacity: 0.7 },
  topActions: { marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" },

  statusPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  dotIdle: { background: "rgba(255,255,255,0.45)" },
  dotSending: { background: "rgba(120,140,255,0.95)", boxShadow: "0 0 0 6px rgba(120,140,255,0.18)" },
  dotReady: { background: "rgba(120,255,200,0.95)", boxShadow: "0 0 0 6px rgba(120,255,200,0.14)" },

  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    cursor: "pointer",
  },

  hero: {
    marginTop: 16,
    padding: "18px 18px",
    borderRadius: 18,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
    display: "flex",
    gap: 16,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  heroLeft: { minWidth: 260 },
  heroKicker: {
    fontSize: 11,
    letterSpacing: 2.4,
    opacity: 0.75,
    fontWeight: 900,
  },
  h1: {
    margin: "6px 0 6px",
    fontSize: 34,
    letterSpacing: 0.2,
    fontWeight: 950,
    color: "#ffffff",
  },
  heroDesc: { fontSize: 13, opacity: 0.78, lineHeight: 1.6, maxWidth: 620 },
  heroRight: { display: "flex", gap: 10, alignItems: "center" },
  metricCard: {
    width: 130,
    padding: "12px 12px",
    borderRadius: 16,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  metricLabel: { fontSize: 12, opacity: 0.75, fontWeight: 800 },
  metricValue: { marginTop: 6, fontSize: 22, fontWeight: 950, color: "#fff" },

  main: {
    marginTop: 16,
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    gap: 16,
  },

  panel: {
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
    minHeight: 360,
    display: "flex",
    flexDirection: "column",
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  panelTitle: { fontSize: 14, fontWeight: 950, letterSpacing: 0.4 },
  panelMeta: { marginTop: 2, fontSize: 12, opacity: 0.72 },

  textareaWrap: { flex: 0, marginTop: 4 },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 16,
    padding: 14,
    resize: "vertical",
    minHeight: 180,
    background: "rgba(6,9,18,0.72)",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.10)",
    outline: "none",
    lineHeight: 1.55,
    fontSize: 14,
  },
  hintRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 10,
    flexWrap: "wrap",
    opacity: 0.75,
    fontSize: 12,
  },
  hintLeft: { color: "rgba(255,255,255,0.8)" },
  hintRight: { color: "rgba(255,255,255,0.7)" },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },

  actionRow: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
  primaryBtn: {
    borderRadius: 14,
    padding: "11px 16px",
    fontWeight: 950,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(90,105,230,0.95))",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 18px 40px rgba(120,140,255,0.18)",
  },
  secondaryBtn: {
    borderRadius: 14,
    padding: "11px 14px",
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    cursor: "pointer",
  },
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" },

  smallBtn: {
    borderRadius: 12,
    padding: "9px 12px",
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 12,
  },
  smallBtnGhost: {
    background: "transparent",
  },

  errorCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    background: "rgba(255,60,60,0.10)",
    border: "1px solid rgba(255,60,60,0.28)",
    color: "#ffe1e1",
  },
  errorTitle: { fontWeight: 950, marginBottom: 6 },
  errorText: { whiteSpace: "pre-wrap", opacity: 0.95, lineHeight: 1.5 },

  securityNote: { marginTop: 14, fontSize: 12, opacity: 0.7 },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.16)",
  },
  searchInput: {
    width: 220,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#ffffff",
    fontSize: 13,
  },

  empty: {
    marginTop: 6,
    padding: 14,
    borderRadius: 16,
    border: "1px dashed rgba(255,255,255,0.20)",
    background: "rgba(0,0,0,0.14)",
    opacity: 0.78,
    lineHeight: 1.6,
    fontSize: 13,
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflow: "auto",
    paddingRight: 6,
  },
  item: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.16)",
    overflow: "hidden",
  },
  itemTop: {
    padding: "12px 12px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  itemQ: {
    fontWeight: 950,
    color: "#ffffff",
    fontSize: 13,
    lineHeight: 1.4,
  },
  itemTime: { marginTop: 4, fontSize: 11, opacity: 0.7 },

  pinBtn: {
    width: 30,
    height: 30,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#ffffff",
    cursor: "pointer",
    flex: "0 0 auto",
  },
  pinBtnOn: {
    background: "rgba(120,255,200,0.16)",
    border: "1px solid rgba(120,255,200,0.28)",
  },

  tinyBtn: {
    borderRadius: 12,
    padding: "8px 10px",
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 12,
  },
  tinyBtnDanger: {
    background: "rgba(255,60,60,0.10)",
    border: "1px solid rgba(255,60,60,0.22)",
  },

  itemDetails: { borderTop: "1px solid rgba(255,255,255,0.08)" },
  itemSummary: {
    padding: "10px 12px",
    cursor: "pointer",
    display: "flex",
    gap: 10,
    alignItems: "center",
    listStyle: "none",
    userSelect: "none",
  },
  answerBox: {
    padding: "10px 12px 14px",
    background: "rgba(6,9,18,0.55)",
  },

  // Markdown styles
  mdH1: { fontSize: 18, fontWeight: 950, margin: "10px 0 8px", color: "#fff" },
  mdH2: { fontSize: 15, fontWeight: 950, margin: "10px 0 6px", color: "#fff" },
  p: { fontSize: 13, lineHeight: 1.65, color: "rgba(255,255,255,0.92)" },
  strong: { color: "#ffffff" },
  link: {
    color: "rgba(160,190,255,0.95)",
    textDecoration: "underline",
    textUnderlineOffset: 3,
  },
  inlineCode: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 12,
    padding: "2px 6px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  pre: {
    margin: "10px 0",
    padding: 12,
    borderRadius: 14,
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.10)",
    overflowX: "auto",
  },
  preCode: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 12,
    color: "rgba(255,255,255,0.92)",
    whiteSpace: "pre",
  },
  ul: { margin: "8px 0", padding: 0, listStyle: "none", display: "grid", gap: 6 },
  li: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.6 },
  liDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 7,
    background: "rgba(120,255,200,0.75)",
    boxShadow: "0 0 0 6px rgba(120,255,200,0.10)",
    flex: "0 0 auto",
  },

  footer: { marginTop: 14, padding: "10px 2px", opacity: 0.6, fontSize: 12, textAlign: "center" },
  footerSmall: { letterSpacing: 0.2 },

  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "grid",
    placeItems: "center",
    zIndex: 50,
    padding: 16,
  },
  modal: {
    width: "min(720px, 100%)",
    borderRadius: 18,
    background: "rgba(10,14,25,0.92)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    overflow: "hidden",
  },
  modalHeader: {
    padding: "14px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  modalBody: { padding: 14 },
  fieldLabel: { fontSize: 12, fontWeight: 950, letterSpacing: 0.4, opacity: 0.9 },
  fieldHint: { marginTop: 6, fontSize: 12, opacity: 0.65 },
  urlInput: {
    marginTop: 10,
    width: "100%",
    borderRadius: 14,
    padding: "12px 12px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.20)",
    color: "#ffffff",
    outline: "none",
    fontSize: 13,
    boxSizing: "border-box",
  },
  modalNote: { marginTop: 12, fontSize: 12, opacity: 0.65, lineHeight: 1.6 },

  // Toast
  toastWrap: {
    position: "fixed",
    right: 18,
    bottom: 18,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    zIndex: 60,
    pointerEvents: "none",
  },
  toast: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: 14,
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
    fontSize: 13,
  },
};
