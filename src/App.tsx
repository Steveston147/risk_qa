import React, { useEffect, useMemo, useRef, useState } from "react";

// n8n Webhook (Production URL)
// 直接ここに書いてOK。将来的に環境変数にするなら VITE_N8N_WEBHOOK_URL を使えます。
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
  at: string; // ISO
  question: string;
  answer: string;
  raw?: unknown;
};

function pickAnswer(payload: ApiResponse): { answer: string; raw: unknown } {
  // 文字列で返ってくる場合
  if (typeof payload === "string") {
    return { answer: payload, raw: payload };
  }

  // オブジェクトで返ってくる場合
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    const candidates: (keyof typeof obj)[] = [
      "answer",
      "result",
      "text",
      "message",
      "output",
    ];

    for (const k of candidates) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) {
        return { answer: v.trim(), raw: payload };
      }
    }

    // よくある: { data: { answer: "..." } } みたいな場合
    const data = obj["data"];
    if (data && typeof data === "object") {
      const dataObj = data as Record<string, unknown>;
      for (const k of candidates) {
        const v = dataObj[k];
        if (typeof v === "string" && v.trim()) {
          return { answer: v.trim(), raw: payload };
        }
      }
    }

    // それでも見つからない → JSON文字列化して返す
    try {
      return { answer: JSON.stringify(payload, null, 2), raw: payload };
    } catch {
      return { answer: String(payload), raw: payload };
    }
  }

  // それ以外
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

export default function App() {
  const envUrl =
    (import.meta as any)?.env?.VITE_N8N_WEBHOOK_URL ||
    (import.meta as any)?.env?.VITE_WEBHOOK_URL;

  const webhookUrl = (envUrl as string) || DEFAULT_WEBHOOK_URL;

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem("risk_qa_history_v1");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoryItem[];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 30);
    } catch {
      return [];
    }
  });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = useMemo(() => q.trim().length > 0 && !loading, [q, loading]);

  useEffect(() => {
    try {
      localStorage.setItem("risk_qa_history_v1", JSON.stringify(history.slice(0, 30)));
    } catch {
      // localStorageが使えない環境でも落とさない
    }
  }, [history]);

  async function send() {
    const question = q.trim();
    if (!question || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // n8n側で受けたい形に合わせてください（まずはquestionだけでOK）
        body: JSON.stringify({ question }),
      });

      // n8nは200でもtext/plainで返すことがあるので両対応
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
        at: new Date().toISOString(),
        question,
        answer: answer || "(No answer returned)",
        raw,
      };

      setHistory((prev) => [item, ...prev].slice(0, 30));
      setQ("");

      // 次の入力に戻りやすいように軽くフォーカス
      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setHistory([]);
    setError(null);
    setQ("");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter / Cmd+Enter で送信
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.brandDot} />
          <div>
            <div style={styles.title}>留学サポートデスク Risk Q&amp;A</div>
            <div style={styles.subTitle}>Webhook-driven UI (React → n8n)</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <div style={styles.badge}>
              {loading ? "Sending..." : "Idle"}
            </div>
          </div>
        </header>

        <main style={styles.main}>
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={styles.cardTitle}>質問</div>
              <div style={styles.cardMeta}>POST /webhook/risk</div>
            </div>

            <textarea
              ref={textareaRef}
              style={styles.textarea}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="例：長期派遣2名体制に切り替える場合の法的リスクと実務上の注意点は？"
              rows={7}
            />

            <div style={styles.actions}>
              <button
                style={{ ...styles.btn, ...(canSend ? styles.btnPrimary : styles.btnDisabled) }}
                onClick={() => void send()}
                disabled={!canSend}
              >
                送信
              </button>

              <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={clearAll} disabled={loading}>
                クリア
              </button>

              <div style={{ marginLeft: "auto", opacity: 0.7, fontSize: 12 }}>
                Ctrl+Enterで送信
              </div>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>エラー</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
              </div>
            )}

            <div style={styles.note}>
              ※ APIキー等の機密は n8n 側にのみ保持（ブラウザには置きません）
            </div>
            <div style={styles.urlLine}>
              Webhook: <span style={styles.mono}>{webhookUrl}</span>
            </div>
          </section>

          <section style={styles.side}>
            <div style={styles.sideHeader}>
              <div style={styles.sideTitle}>履歴</div>
              <div style={styles.sideHint}>最新30件（端末に保存）</div>
            </div>

            {history.length === 0 ? (
              <div style={styles.empty}>
                まだ履歴がありません。左のフォームから質問を送ってください。
              </div>
            ) : (
              <div style={styles.list}>
                {history.map((h, idx) => (
                  <details key={idx} style={styles.item} open={idx === 0}>
                    <summary style={styles.itemSummary}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.question}
                      </div>
                      <div style={styles.itemTime}>{formatTime(h.at)}</div>
                    </summary>

                    <div style={styles.itemBody}>
                      <div style={styles.answerLabel}>Answer</div>
                      <div style={styles.answerText}>{h.answer}</div>

                      <div style={styles.itemBtns}>
                        <button
                          style={{ ...styles.btn, ...styles.btnTiny }}
                          onClick={() => {
                            setQ(h.question);
                            setTimeout(() => textareaRef.current?.focus(), 0);
                          }}
                        >
                          質問を再利用
                        </button>

                        <button
                          style={{ ...styles.btn, ...styles.btnTiny }}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(h.answer);
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          回答をコピー
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </main>

        <footer style={styles.footer}>
          <span style={styles.footerSmall}>© 留学サポートデスク</span>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 700px at 20% 10%, rgba(120,140,255,0.25), transparent 60%)," +
      "radial-gradient(900px 600px at 80% 30%, rgba(120,255,200,0.12), transparent 55%)," +
      "linear-gradient(180deg, #0b1220, #070b12)",
    color: "#eaf0ff",
    padding: 24,
    boxSizing: "border-box",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
  },
  shell: {
    maxWidth: 1100,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    gap: 14,
    alignItems: "center",
    padding: "16px 18px",
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },
  brandDot: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background:
      "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(120,140,255,0.55) 45%, rgba(80,90,190,0.35) 75%, rgba(0,0,0,0.2))",
  },
  title: {
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: 0.2,
  },
  subTitle: {
    marginTop: 2,
    fontSize: 12,
    opacity: 0.75,
  },
  badge: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  main: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: 16,
    marginTop: 16,
  },
  card: {
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.30)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.4,
  },
  cardMeta: {
    marginLeft: "auto",
    fontSize: 12,
    opacity: 0.7,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 14,
    padding: 14,
    resize: "vertical",
    minHeight: 170,
    background: "rgba(10,14,25,0.7)",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.10)",
    outline: "none",
    lineHeight: 1.5,
    fontSize: 14,
  },
  actions: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  btn: {
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 800,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    cursor: "pointer",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(90,105,230,0.95))",
    border: "1px solid rgba(255,255,255,0.18)",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  btnGhost: {
    background: "transparent",
  },
  btnTiny: {
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 800,
  },
  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: "rgba(255,60,60,0.10)",
    border: "1px solid rgba(255,60,60,0.25)",
    color: "#ffd7d7",
    fontSize: 13,
  },
  note: {
    marginTop: 12,
    fontSize: 12,
    opacity: 0.75,
  },
  urlLine: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.8,
  },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
  side: {
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.26)",
    display: "flex",
    flexDirection: "column",
    minHeight: 360,
  },
  sideHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 12,
  },
  sideTitle: {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.4,
  },
  sideHint: {
    marginLeft: "auto",
    fontSize: 12,
    opacity: 0.7,
  },
  empty: {
    opacity: 0.75,
    fontSize: 13,
    lineHeight: 1.6,
    padding: 12,
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.12)",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflow: "auto",
    paddingRight: 6,
  },
  item: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.16)",
    overflow: "hidden",
  },
  itemSummary: {
    listStyle: "none",
    cursor: "pointer",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  itemTime: {
    fontSize: 11,
    opacity: 0.7,
  },
  itemBody: {
    padding: "10px 12px 12px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  answerLabel: {
    fontSize: 11,
    opacity: 0.7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  answerText: {
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
    fontSize: 13,
    color: "#ffffff",
  },
  itemBtns: {
    marginTop: 10,
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  footer: {
    marginTop: 14,
    padding: "10px 2px",
    opacity: 0.6,
    fontSize: 12,
    textAlign: "center",
  },
  footerSmall: {
    letterSpacing: 0.2,
  },
};
