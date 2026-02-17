import React, { useMemo, useRef, useState } from "react";
import "./App.css";

const WEBHOOK_URL = "https://stevston.app.n8n.cloud/webhook/risk";

type N8nResponse = Record<string, unknown> & {
  answer?: unknown;
  output?: unknown;
  response?: unknown;
  text?: unknown;
  message?: string;
  error?: string;
};

type HistoryItem = {
  at: string;
  question: string;
  answer: string;
  raw?: N8nResponse;
};

function toDisplayString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pickAnswer(data: N8nResponse): string {
  const a = data.answer ?? data.output ?? data.response ?? data.text ?? "";
  return toDisplayString(a);
}

export default function App() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  const [answer, setAnswer] = useState<string>("");
  const [raw, setRaw] = useState<N8nResponse | null>(null);
  const [error, setError] = useState<string>("");

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = useMemo(() => question.trim().length > 0 && !loading, [question, loading]);

  async function send() {
    setError("");
    setAnswer("");
    setRaw(null);
    setLoading(true);

    const q = question.trim();
    const startedAt = performance.now();

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      const text = await res.text();
      let data: N8nResponse;

      try {
        data = (text ? JSON.parse(text) : {}) as N8nResponse;
      } catch {
        data = { rawText: text } as unknown as N8nResponse;
      }

      if (!res.ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const aStr = pickAnswer(data);

      setAnswer(aStr);
      setRaw(data);

      const elapsedMs = Math.round(performance.now() - startedAt);
      setHistory((prev) =>
        [
          {
            at: new Date().toISOString(),
            question: q,
            answer: aStr,
            raw: data,
          },
          ...prev,
        ].slice(0, 15)
      );

      // 次の入力に戻りやすいように軽くフォーカス
      setTimeout(() => textareaRef.current?.focus(), 0);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = elapsedMs;
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) {
      e.preventDefault();
      send();
    }
  }

  function clearAll() {
    setQuestion("");
    setAnswer("");
    setRaw(null);
    setError("");
    textareaRef.current?.focus();
  }

  function useHistory(item: HistoryItem) {
    setQuestion(item.question);
    setAnswer(item.answer);
    setRaw(item.raw ?? null);
    setError("");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <div className="app">
      <TopBar
        onClear={clearAll}
        showDebug={showDebug}
        setShowDebug={setShowDebug}
        loading={loading}
      />

      <main className="layout">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <div className="kicker">Ask</div>
              <h1 className="title">Risk Q&A</h1>
              <div className="subtitle">
                Reactは出入口だけ。処理はn8n（Webhook）で実行します。
              </div>
            </div>

            <div className="status">
              <StatusPill loading={loading} error={!!error} hasAnswer={!!answer} />
            </div>
          </div>

          <div className="card">
            <div className="field">
              <label className="label">質問</label>
              <textarea
                ref={textareaRef}
                className="textarea"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKeyDown}
                rows={8}
                placeholder="例：長期派遣2名体制に切り替える場合の法的リスクと実務上の注意点は？"
              />
              <div className="hintRow">
                <div className="hint">Ctrl+Enterで送信</div>
                <div className="hint mono">POST {"/webhook/risk"}</div>
              </div>
            </div>

            <div className="actions">
              <button className="btn primary" onClick={send} disabled={!canSend}>
                {loading ? (
                  <>
                    <span className="spinner" aria-hidden />
                    送信中…
                  </>
                ) : (
                  "送信"
                )}
              </button>

              <button className="btn" onClick={clearAll} disabled={loading}>
                クリア
              </button>

              <div className="spacer" />

              <small className="safeNote">
                ※ APIキーはn8n側にのみ保持（ブラウザには置きません）
              </small>
            </div>

            {error && (
              <div className="alert error">
                <div className="alertTitle">エラー</div>
                <div className="alertBody">{error}</div>
                <div className="alertFoot">
                  よくある原因：CORS / n8n側500 / 返却がJSONでない / URL違い など
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardHeader">
              <div>
                <div className="kicker">Answer</div>
                <h2 className="sectionTitle">回答</h2>
              </div>
              <div className="cardHeaderRight">
                {answer && (
                  <button
                    className="btn subtle"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(answer);
                      } catch {}
                    }}
                  >
                    コピー
                  </button>
                )}
              </div>
            </div>

            {!answer && !loading && <div className="empty">まだ回答はありません。</div>}
            {loading && (
              <div className="skeletonWrap" aria-hidden>
                <div className="skeleton line" />
                <div className="skeleton line" />
                <div className="skeleton line" />
                <div className="skeleton line short" />
              </div>
            )}
            {!!answer && <div className="answer">{answer}</div>}

            {showDebug && raw && (
              <details className="debug" open={false}>
                <summary>Raw JSON（デバッグ）</summary>
                <pre className="pre">{JSON.stringify(raw, null, 2)}</pre>
              </details>
            )}
          </div>
        </section>

        <aside className="side">
          <div className="sideCard">
            <div className="sideHeader">
              <div>
                <div className="kicker">History</div>
                <h2 className="sectionTitle">履歴</h2>
              </div>
              <div className="sideHeaderRight">
                <span className="count">{history.length}/15</span>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="empty">まだ履歴はありません。</div>
            ) : (
              <div className="historyList">
                {history.map((h, idx) => (
                  <button key={idx} className="historyItem" onClick={() => useHistory(h)}>
                    <div className="historyMeta">
                      <span className="mono">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    <div className="historyQ">{h.question}</div>
                    <div className="historyA">{h.answer}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sideCard">
            <div className="kicker">Endpoint</div>
            <div className="endpoint mono">{WEBHOOK_URL}</div>
            <div className="miniHint">
              送信Bodyは <span className="mono">{"{ question: string }"}</span> です
            </div>
          </div>
        </aside>
      </main>

      <footer className="footer">
        <span className="mono">n8n Cloud</span> + <span className="mono">React</span>
        <span className="dot">•</span>
        出入口UI
      </footer>
    </div>
  );
}

function TopBar(props: {
  onClear: () => void;
  showDebug: boolean;
  setShowDebug: (v: boolean) => void;
  loading: boolean;
}) {
  const { onClear, showDebug, setShowDebug, loading } = props;
  return (
    <div className="topbar">
      <div className="brand">
        <div className="logo" aria-hidden />
        <div>
          <div className="brandName">留学サポートデスク Risk Q&A</div>
          <div className="brandSub">Webhook-driven UI</div>
        </div>
      </div>

      <div className="topbarActions">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => setShowDebug(e.target.checked)}
          />
          <span>Debug</span>
        </label>

        <button className="btn" onClick={onClear} disabled={loading}>
          クリア
        </button>
      </div>
    </div>
  );
}

function StatusPill(props: { loading: boolean; error: boolean; hasAnswer: boolean }) {
  const { loading, error, hasAnswer } = props;

  if (loading) {
    return (
      <div className="pill neutral">
        <span className="pillDot" />
        Processing…
      </div>
    );
  }
  if (error) {
    return (
      <div className="pill danger">
        <span className="pillDot" />
        Error
      </div>
    );
  }
  if (hasAnswer) {
    return (
      <div className="pill ok">
        <span className="pillDot" />
        Ready
      </div>
    );
  }
  return (
    <div className="pill neutral">
      <span className="pillDot" />
      Idle
    </div>
  );
}
