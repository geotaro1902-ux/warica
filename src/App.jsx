// src/App.jsx
import { useState, useEffect, useCallback } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// ─── 対応通貨 ──────────────────────────────────────────
const CURRENCIES = [
  { code: "JPY", symbol: "¥",  flag: "🇯🇵", name: "日本円" },
  { code: "USD", symbol: "$",  flag: "🇺🇸", name: "米ドル" },
  { code: "EUR", symbol: "€",  flag: "🇪🇺", name: "ユーロ" },
  { code: "GBP", symbol: "£",  flag: "🇬🇧", name: "英ポンド" },
  { code: "KRW", symbol: "₩",  flag: "🇰🇷", name: "韓国ウォン" },
  { code: "CNY", symbol: "¥",  flag: "🇨🇳", name: "中国元" },
  { code: "THB", symbol: "฿",  flag: "🇹🇭", name: "タイバーツ" },
  { code: "AUD", symbol: "A$", flag: "🇦🇺", name: "豪ドル" },
  { code: "HKD", symbol: "HK$",flag: "🇭🇰", name: "香港ドル" },
  { code: "SGD", symbol: "S$", flag: "🇸🇬", name: "シンガポールドル" },
  { code: "TWD", symbol: "NT$",flag: "🇹🇼", name: "台湾ドル" },
  { code: "CAD", symbol: "C$", flag: "🇨🇦", name: "カナダドル" },
];

const getCurrency = (code) => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

// 為替レートをAPIから取得（JPY基準、無料・キー不要）
// https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api
async function fetchRates() {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/jpy.json");
    const data = await res.json();
    // data.jpy[code] = JPY 1円あたりの外貨量 → 逆数で「1外貨 = X円」
    const raw = data.jpy;
    const rates = {};
    for (const [code, val] of Object.entries(raw)) {
      rates[code.toUpperCase()] = 1 / val; // 1外貨 → 円
    }
    rates["JPY"] = 1;
    return rates;
  } catch {
    return null;
  }
}

// 金額を円換算
function toJPY(amount, currency, rates) {
  if (currency === "JPY" || !rates) return amount;
  const rate = rates[currency];
  return rate ? Math.round(amount * rate) : amount;
}

// ─── 定数 ─────────────────────────────────────────────
const COLORS = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8","#F7DC6F","#BB8FCE","#85C1E9"];
const EMOJIS = ["💴","🍜","🍻","🚗","🏨","🎉","🛍️","🎮","🏕️","✈️"];

// ─── 精算アルゴリズム（円換算済み金額で計算）─────────
function calcSettlement(members, expenses, rates) {
  const balance = {};
  members.forEach(m => (balance[m.id] = 0));
  expenses.forEach(exp => {
    const parts = exp.participants?.length > 0 ? exp.participants : members.map(m => m.id);
    const amountJPY = toJPY(exp.amount, exp.currency || "JPY", rates);
    const share = amountJPY / parts.length;
    balance[exp.paidBy] = (balance[exp.paidBy] || 0) + amountJPY;
    parts.forEach(pid => { balance[pid] = (balance[pid] || 0) - share; });
  });
  const creditors = [], debtors = [];
  Object.entries(balance).forEach(([id, amt]) => {
    if (amt > 0.5) creditors.push({ id, amt });
    else if (amt < -0.5) debtors.push({ id, amt: -amt });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const txns = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const send = Math.min(creditors[ci].amt, debtors[di].amt);
    txns.push({ from: debtors[di].id, to: creditors[ci].id, amount: Math.round(send) });
    creditors[ci].amt -= send;
    debtors[di].amt -= send;
    if (creditors[ci].amt < 0.5) ci++;
    if (debtors[di].amt < 0.5) di++;
  }
  return { balance, transactions: txns };
}

// ─── 共通コンポーネント ────────────────────────────────
const Avatar = ({ name, color, size = 36 }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: size * 0.4, flexShrink: 0, boxShadow: `0 2px 8px ${color}55` }}>
    {name?.[0] || "?"}
  </div>
);

const Icon = ({ name, size = 20 }) => {
  const paths = {
    plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    trash:   <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>,
    check:   <polyline points="20 6 9 17 4 12"/>,
    arrow:   <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    edit:    <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    close:   <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    link:    <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    lock:    <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    refresh: <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
};

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: "28px 24px 52px", width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", animation: "slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1a2e" }}>{title}</h2>
          <button onClick={onClose} style={{ border: "none", background: "#f0f0f5", borderRadius: "50%", width: 34, height: 34, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#777" }}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const StyledInput = ({ value, onChange, placeholder, type = "text", style: s, onKeyDown, autoFocus }) => (
  <input value={value} onChange={onChange} placeholder={placeholder} type={type} onKeyDown={onKeyDown} autoFocus={autoFocus}
    style={{ width: "100%", border: "2px solid #f0f0f5", borderRadius: 14, padding: "13px 16px", fontSize: 15, fontFamily: "inherit", color: "#1a1a2e", background: "#fafafa", transition: "border-color 0.2s", ...s }} />
);

const PrimaryBtn = ({ onClick, disabled, children, style: s }) => (
  <button onClick={onClick} disabled={disabled} style={{ background: "linear-gradient(135deg, #667eea, #764ba2)", border: "none", borderRadius: 14, padding: "15px 24px", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", ...s }}>
    {children}
  </button>
);

const EmptyState = ({ emoji, text }) => (
  <div style={{ textAlign: "center", paddingTop: 60 }}>
    <div style={{ fontSize: 48, marginBottom: 14 }}>{emoji}</div>
    <div style={{ color: "#ccc", fontSize: 15 }}>{text}</div>
  </div>
);

const CopyToast = ({ show }) => !show ? null : (
  <div style={{ position: "fixed", bottom: 110, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", color: "#fff", padding: "12px 22px", borderRadius: 14, fontSize: 14, fontWeight: 600, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
    ✅ URLをコピーしました！
  </div>
);

// ─── 為替レートバッジ ──────────────────────────────────
function RateBadge({ rates, loading, onRefresh }) {
  if (loading) return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "5px 12px", fontSize: 12 }}>
      <span style={{ opacity: 0.7 }}>レート取得中...</span>
    </div>
  );
  if (!rates) return (
    <button onClick={onRefresh} style={{ border: "none", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,80,80,0.25)", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
      ⚠️ レート取得失敗 · 再試行
    </button>
  );
  return (
    <button onClick={onRefresh} style={{ border: "none", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "5px 12px", fontSize: 12, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ecdc4", boxShadow: "0 0 6px #4ecdc4", flexShrink: 0 }} />
      リアルタイムレート · タップで更新
    </button>
  );
}

// ─── 通貨セレクター ────────────────────────────────────
function CurrencySelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = getCurrency(value);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ border: "2px solid #f0f0f5", borderRadius: 14, padding: "12px 14px", background: "#fafafa", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap" }}>
        <span>{cur.flag}</span>
        <span>{cur.code}</span>
        <span style={{ fontSize: 11, color: "#aaa", fontWeight: 400 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, background: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.15)", zIndex: 50, minWidth: 220, maxHeight: 320, overflowY: "auto", padding: 8 }}>
          {CURRENCIES.map(c => (
            <button key={c.code} onClick={() => { onChange(c.code); setOpen(false); }}
              style={{ width: "100%", border: "none", background: value === c.code ? "#f0edff" : "none", borderRadius: 12, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit", fontSize: 14, color: "#1a1a2e", textAlign: "left" }}>
              <span style={{ fontSize: 20 }}>{c.flag}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{c.code} <span style={{ fontWeight: 400, color: "#888" }}>{c.symbol}</span></div>
                <div style={{ fontSize: 11, color: "#aaa" }}>{c.name}</div>
              </div>
              {value === c.code && <span style={{ marginLeft: "auto", color: "#667eea" }}><Icon name="check" size={14} /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── トップページ ──────────────────────────────────────
function TopScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const createGroup = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const ref = await addDoc(collection(db, "groups"), {
      name: name.trim(), desc: desc.trim(),
      members: [], expenses: [],
      createdAt: serverTimestamp(),
    });
    setSaving(false);
    navigate(`/group/${ref.id}`);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", fontFamily: "'Noto Sans JP', sans-serif", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 28px 0", color: "#fff", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>💸</div>
        <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7, fontWeight: 600, marginBottom: 12 }}>WARICA</div>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, lineHeight: 1.2 }}>割り勘アプリ</h1>
        <p style={{ margin: "14px 0 0", opacity: 0.75, fontSize: 15, lineHeight: 1.7 }}>
          外貨対応 · リアルタイム為替レート<br/>URLを共有するだけ
        </p>
        <div style={{ marginTop: 28, background: "rgba(255,255,255,0.12)", borderRadius: 18, padding: "16px 20px", maxWidth: 340, textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 700, fontSize: 13 }}>
            <Icon name="lock" size={15} /> URLを知っている人だけアクセス可能
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.7 }}>
            各イベントには固有のURLが発行されます。URLを共有した相手だけがアクセスできます。
          </div>
        </div>
      </div>
      <div style={{ background: "#f8f7ff", borderRadius: "28px 28px 0 0", marginTop: 40, padding: "32px 24px 52px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div style={{ fontSize: 13, color: "#999", fontWeight: 700, letterSpacing: 1, marginBottom: 16 }}>新しいイベントを作成</div>
          <StyledInput value={name} onChange={e => setName(e.target.value)} placeholder="イベント名（例：ヨーロッパ旅行 ✈️）" onKeyDown={e => e.key === "Enter" && createGroup()} autoFocus />
          <StyledInput value={desc} onChange={e => setDesc(e.target.value)} placeholder="メモ（任意）" style={{ marginTop: 12 }} />
          <PrimaryBtn onClick={createGroup} disabled={!name.trim() || saving} style={{ width: "100%", marginTop: 20, fontSize: 16 }}>
            {saving ? "作成中..." : "イベントを作成してURLを取得 →"}
          </PrimaryBtn>
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: "#bbb", lineHeight: 1.6 }}>
            作成後に表示されるURLを参加者に共有してください
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── グループ画面 ──────────────────────────────────────
function GroupScreen() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState("expenses");
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddExp, setShowAddExp] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [editingExp, setEditingExp] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showShareBanner, setShowShareBanner] = useState(false);

  // 為替レート
  const [rates, setRates] = useState(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesDate, setRatesDate] = useState(null);

  const loadRates = useCallback(async () => {
    setRatesLoading(true);
    const r = await fetchRates();
    setRates(r);
    setRatesDate(r ? new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
    setRatesLoading(false);
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "groups", groupId), snap => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        setShowShareBanner(prev => prev === false && data.members.length === 0 ? true : prev);
        setGroup(data);
      } else {
        setNotFound(true);
      }
    });
    return unsub;
  }, [groupId]);

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const updateGroup = (data) => updateDoc(doc(db, "groups", groupId), data);

  const addMember = async () => {
    if (!memberName.trim() || !group) return;
    const color = COLORS[group.members.length % COLORS.length];
    await updateGroup({ members: [...group.members, { id: "m" + Date.now(), name: memberName.trim(), color }] });
    setMemberName(""); setShowAddMember(false); setShowShareBanner(false);
  };

  const deleteMember = async (mid) => {
    if (!window.confirm("削除しますか？")) return;
    await updateGroup({ members: group.members.filter(m => m.id !== mid), expenses: group.expenses.filter(e => e.paidBy !== mid) });
  };

  const saveExp = async (exp) => {
    const expenses = exp.id
      ? group.expenses.map(e => e.id === exp.id ? exp : e)
      : [...group.expenses, { ...exp, id: "e" + Date.now() }];
    await updateGroup({ expenses });
    setShowAddExp(false); setEditingExp(null);
  };

  const deleteExp = async (eid) => {
    if (!window.confirm("削除しますか？")) return;
    await updateGroup({ expenses: group.expenses.filter(e => e.id !== eid) });
  };

  const getMember = (id) => group?.members.find(m => m.id === id);

  if (notFound) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans JP', sans-serif", background: "#f8f7ff", padding: 24 }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
      <div style={{ fontWeight: 700, fontSize: 20, color: "#1a1a2e", marginBottom: 8 }}>アクセスできません</div>
      <div style={{ color: "#aaa", fontSize: 14, marginBottom: 28, textAlign: "center", lineHeight: 1.7 }}>URLが間違っているか、このイベントは存在しません</div>
      <PrimaryBtn onClick={() => navigate("/")}>新しいイベントを作る</PrimaryBtn>
    </div>
  );

  if (!group) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#aaa", fontFamily: "'Noto Sans JP', sans-serif" }}>
      読み込み中...
    </div>
  );

  const { balance, transactions } = calcSettlement(group.members, group.expenses, rates);
  const totalJPY = group.expenses.reduce((s, e) => s + toJPY(e.amount, e.currency || "JPY", rates), 0);

  // 使用中の通貨一覧（ユニーク）
  const usedCurrencies = [...new Set(group.expenses.map(e => e.currency || "JPY").filter(c => c !== "JPY"))];

  return (
    <div style={{ minHeight: "100vh", background: "#f8f7ff", fontFamily: "'Noto Sans JP', sans-serif" }}>

      {/* ヘッダー */}
      <div style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "52px 24px 84px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <button onClick={() => navigate("/")} style={{ border: "none", background: "rgba(255,255,255,0.18)", borderRadius: 12, padding: "8px 14px", cursor: "pointer", color: "#fff", fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}>
            + 新規作成
          </button>
          <button onClick={copyUrl} style={{ border: "none", background: "rgba(255,255,255,0.18)", borderRadius: 12, padding: "8px 14px", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}>
            <Icon name="link" size={15} /> URLをコピー
          </button>
        </div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{group.name}</h1>
        {group.desc && <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 14 }}>{group.desc}</p>}

        {/* 為替レートバッジ */}
        <div style={{ marginTop: 10 }}>
          <RateBadge rates={rates} loading={ratesLoading} onRefresh={loadRates} />
          {ratesDate && !ratesLoading && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>最終更新: {ratesDate}</div>
          )}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ opacity: 0.65, fontSize: 11, fontWeight: 600, marginBottom: 3 }}>合計（円換算）</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>¥{totalJPY.toLocaleString()}</div>
          </div>
          {[["メンバー", `${group.members.length}人`], ["支払い", `${group.expenses.length}件`]].map(([l, v]) => (
            <div key={l}>
              <div style={{ opacity: 0.65, fontSize: 11, fontWeight: 600, marginBottom: 3 }}>{l}</div>
              <div style={{ fontWeight: 900, fontSize: 20 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 使用中の通貨バッジ */}
        {usedCurrencies.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, opacity: 0.6, display: "flex", alignItems: "center" }}>使用通貨:</div>
            {["JPY", ...usedCurrencies].map(code => {
              const c = getCurrency(code);
              const rate = rates?.[code];
              return (
                <div key={code} style={{ background: "rgba(255,255,255,0.18)", borderRadius: 12, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                  {c.flag} {code}
                  {code !== "JPY" && rate && <span style={{ opacity: 0.75 }}>= ¥{Math.round(rate).toLocaleString()}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* URLシェアバナー */}
      {showShareBanner && (
        <div onClick={copyUrl} style={{ margin: "16px 20px 0", background: "#fff8e1", borderRadius: 16, padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, border: "1.5px solid #ffe082" }}>
          <div style={{ fontSize: 24 }}>🔗</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>URLを参加者に共有しよう</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>タップしてURLをコピー</div>
          </div>
          <div style={{ background: "#667eea", color: "#fff", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>コピー</div>
        </div>
      )}

      {/* タブ */}
      <div style={{ background: "#fff", borderRadius: "22px 22px 0 0", marginTop: showShareBanner ? 16 : -24, boxShadow: "0 -4px 20px rgba(102,126,234,0.08)" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #f0f0f5", padding: "0 20px" }}>
          {[["expenses","💸 支払い"], ["members","👥 メンバー"], ["settle","✨ 精算"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ flex: 1, border: "none", background: "none", padding: "16px 0", cursor: "pointer", fontWeight: tab === key ? 700 : 500, color: tab === key ? "#667eea" : "#bbb", fontSize: 13, borderBottom: tab === key ? "2.5px solid #667eea" : "2.5px solid transparent", fontFamily: "inherit" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      <div style={{ padding: "20px 20px 120px" }}>

        {/* 支払いタブ */}
        {tab === "expenses" && (
          <div>
            {group.members.length === 0 && <EmptyState emoji="👥" text="先にメンバーを追加してください" />}
            {group.members.length > 0 && group.expenses.length === 0 && <EmptyState emoji="🧾" text="支払いを追加しましょう" />}
            {group.expenses.map(exp => {
              const payer = getMember(exp.paidBy);
              const parts = exp.participants?.length > 0 ? exp.participants.map(getMember).filter(Boolean) : group.members;
              const currency = exp.currency || "JPY";
              const cur = getCurrency(currency);
              const amountJPY = toJPY(exp.amount, currency, rates);
              const isForex = currency !== "JPY";
              return (
                <div key={exp.id} style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 46, height: 46, borderRadius: 14, background: "#f0edff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{exp.emoji || "💴"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.description}</div>
                    <div style={{ fontSize: 12, color: "#bbb", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                      {payer && <Avatar name={payer.name} color={payer.color} size={14} />}
                      <span>{payer?.name} · {parts.length}人で割り勘</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginRight: 4 }}>
                    {/* 元通貨の金額 */}
                    <div style={{ fontWeight: 800, fontSize: 16, color: "#667eea" }}>
                      {cur.flag} {cur.symbol}{exp.amount.toLocaleString()} {isForex ? cur.code : ""}
                    </div>
                    {/* 円換算（外貨のとき） */}
                    {isForex && (
                      <div style={{ fontSize: 12, color: "#aaa", marginTop: 1 }}>
                        ≈ ¥{amountJPY.toLocaleString()}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#ccc", marginTop: 1 }}>
                      ÷{parts.length} = ¥{Math.round(amountJPY / parts.length).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => { setEditingExp(exp); setShowAddExp(true); }} style={{ border: "none", background: "#f0edff", borderRadius: 10, padding: "7px", cursor: "pointer", color: "#667eea", display: "flex" }}><Icon name="edit" size={14} /></button>
                    <button onClick={() => deleteExp(exp.id)} style={{ border: "none", background: "#fff0f0", borderRadius: 10, padding: "7px", cursor: "pointer", color: "#ff6b6b", display: "flex" }}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* メンバータブ */}
        {tab === "members" && (
          <div>
            {group.members.length === 0 && <EmptyState emoji="👤" text="メンバーを追加しましょう" />}
            {group.members.map(m => {
              const bal = Math.round(balance[m.id] || 0);
              const paidJPY = group.expenses.filter(e => e.paidBy === m.id).reduce((s, e) => s + toJPY(e.amount, e.currency || "JPY", rates), 0);
              return (
                <div key={m.id} style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 14 }}>
                  <Avatar name={m.name} color={m.color} size={46} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#1a1a2e" }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: "#bbb", marginTop: 2 }}>支払い合計: ¥{Math.round(paidJPY).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: "right", marginRight: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: bal >= 0 ? "#4ecdc4" : "#ff6b6b" }}>{bal >= 0 ? "+" : ""}¥{bal.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: "#ccc" }}>{bal >= 0 ? "受け取る" : "支払う"}</div>
                  </div>
                  <button onClick={() => deleteMember(m.id)} style={{ border: "none", background: "#fff0f0", borderRadius: 12, padding: "9px 11px", cursor: "pointer", color: "#ff6b6b", display: "flex" }}><Icon name="trash" size={16} /></button>
                </div>
              );
            })}
          </div>
        )}

        {/* 精算タブ */}
        {tab === "settle" && (
          <div>
            {/* レート注意書き（外貨使用時） */}
            {usedCurrencies.length > 0 && (
              <div style={{ background: "#f0edff", borderRadius: 14, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#667eea", lineHeight: 1.6 }}>
                💱 精算額はすべて<strong>円換算</strong>で計算されています。<br/>
                為替レートは取得時点のものです。
              </div>
            )}

            {transactions.length === 0 ? (
              <div style={{ textAlign: "center", paddingTop: 44 }}>
                <div style={{ fontSize: 52, marginBottom: 14 }}>✨</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "#1a1a2e", marginBottom: 8 }}>精算完了！</div>
                <div style={{ color: "#bbb", fontSize: 14 }}>支払いは均等です</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#bbb", fontWeight: 700, letterSpacing: 2, marginBottom: 14 }}>送金リスト（{transactions.length}件）</div>
                {transactions.map((t, i) => {
                  const from = getMember(t.from), to = getMember(t.to);
                  return (
                    <div key={i} style={{ background: "#fff", borderRadius: 18, padding: "20px 22px", marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ textAlign: "center" }}>
                          <Avatar name={from?.name} color={from?.color} size={44} />
                          <div style={{ fontSize: 12, color: "#444", fontWeight: 700, marginTop: 6 }}>{from?.name}</div>
                        </div>
                        <div style={{ flex: 1, textAlign: "center" }}>
                          <div style={{ fontWeight: 900, fontSize: 22, color: "#667eea" }}>¥{t.amount.toLocaleString()}</div>
                          <div style={{ color: "#ddd", marginTop: 6, display: "flex", justifyContent: "center" }}><Icon name="arrow" size={20} /></div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <Avatar name={to?.name} color={to?.color} size={44} />
                          <div style={{ fontSize: 12, color: "#444", fontWeight: 700, marginTop: 6 }}>{to?.name}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {group.members.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 18, padding: "20px", marginTop: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ fontSize: 12, color: "#bbb", fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>収支サマリー（円換算）</div>
                {group.members.map(m => {
                  const bal = Math.round(balance[m.id] || 0);
                  const pct = totalJPY > 0 ? Math.min(Math.abs(bal) / totalJPY * 100, 100) : 0;
                  return (
                    <div key={m.id} style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar name={m.name} color={m.color} size={26} />
                          <span style={{ fontSize: 14, color: "#333", fontWeight: 600 }}>{m.name}</span>
                        </div>
                        <span style={{ fontWeight: 700, color: bal >= 0 ? "#4ecdc4" : "#ff6b6b", fontSize: 14 }}>{bal >= 0 ? "+" : ""}¥{bal.toLocaleString()}</span>
                      </div>
                      <div style={{ height: 7, background: "#f0f0f5", borderRadius: 4 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: bal >= 0 ? "#4ecdc4" : "#ff6b6b", borderRadius: 4, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={copyUrl} style={{ width: "100%", marginTop: 20, border: "2px solid #667eea", borderRadius: 14, padding: "14px", background: "#fff", color: "#667eea", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon name="link" size={18} /> このURLを友達に送る
            </button>
          </div>
        )}
      </div>

      {tab === "members" && (
        <button onClick={() => setShowAddMember(true)} style={{ position: "fixed", bottom: 32, right: 24, width: 62, height: 62, borderRadius: "50%", background: "linear-gradient(135deg, #4ecdc4, #45b7d1)", border: "none", cursor: "pointer", boxShadow: "0 8px 28px rgba(78,205,196,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <Icon name="plus" size={28} />
        </button>
      )}
      {tab === "expenses" && group.members.length > 0 && (
        <button onClick={() => { setEditingExp(null); setShowAddExp(true); }} style={{ position: "fixed", bottom: 32, right: 24, width: 62, height: 62, borderRadius: "50%", background: "linear-gradient(135deg, #667eea, #764ba2)", border: "none", cursor: "pointer", boxShadow: "0 8px 28px rgba(102,126,234,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <Icon name="plus" size={28} />
        </button>
      )}

      <Modal open={showAddMember} onClose={() => { setShowAddMember(false); setMemberName(""); }} title="メンバーを追加">
        <StyledInput value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="名前を入力" onKeyDown={e => e.key === "Enter" && addMember()} autoFocus />
        <PrimaryBtn onClick={addMember} disabled={!memberName.trim()} style={{ width: "100%", marginTop: 20 }}>追加する</PrimaryBtn>
      </Modal>

      <ExpenseModal open={showAddExp} onClose={() => { setShowAddExp(false); setEditingExp(null); }} members={group.members} initialData={editingExp} onSave={saveExp} rates={rates} />

      <CopyToast show={copied} />
    </div>
  );
}

// ─── 支払いモーダル ────────────────────────────────────
function ExpenseModal({ open, onClose, members, initialData, onSave, rates }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("JPY");
  const [paidBy, setPaidBy] = useState("");
  const [participants, setParticipants] = useState([]);
  const [emoji, setEmoji] = useState("💴");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setDesc(initialData.description || "");
      setAmount(String(initialData.amount || ""));
      setCurrency(initialData.currency || "JPY");
      setPaidBy(initialData.paidBy || members[0]?.id || "");
      setParticipants(initialData.participants || []);
      setEmoji(initialData.emoji || "💴");
    } else {
      setDesc(""); setAmount(""); setCurrency("JPY");
      setPaidBy(members[0]?.id || ""); setParticipants([]); setEmoji("💴");
    }
  }, [open]);

  const toggle = (mid) => setParticipants(prev => prev.includes(mid) ? prev.filter(x => x !== mid) : [...prev, mid]);
  const canSave = desc.trim() && parseFloat(amount) > 0 && paidBy;

  const cur = getCurrency(currency);
  const amountNum = parseFloat(amount) || 0;
  const amountJPY = toJPY(amountNum, currency, rates);
  const isForex = currency !== "JPY";

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    await onSave({ ...(initialData || {}), description: desc.trim(), amount: amountNum, currency, paidBy, participants, emoji });
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} title={initialData ? "支払いを編集" : "支払いを追加"}>
      {/* 絵文字 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {EMOJIS.map(e => (
          <button key={e} onClick={() => setEmoji(e)} style={{ fontSize: 20, border: "none", borderRadius: 12, width: 44, height: 44, cursor: "pointer", background: emoji === e ? "#e8e4ff" : "#f8f7ff" }}>{e}</button>
        ))}
      </div>

      <StyledInput value={desc} onChange={e => setDesc(e.target.value)} placeholder="内容（例：ランチ）" />

      {/* 金額 + 通貨セレクター */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-start" }}>
        <CurrencySelector value={currency} onChange={setCurrency} />
        <div style={{ flex: 1, position: "relative" }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#667eea", fontWeight: 700, fontSize: 15 }}>{cur.symbol}</span>
          <StyledInput
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
            type="number"
            style={{ paddingLeft: 34 }}
          />
        </div>
      </div>

      {/* 円換算プレビュー（外貨のとき） */}
      {isForex && amountNum > 0 && (
        <div style={{ marginTop: 8, padding: "10px 14px", background: "#f0edff", borderRadius: 12, fontSize: 13, color: "#667eea", display: "flex", alignItems: "center", gap: 6 }}>
          💱
          {rates ? (
            <>¥{amountJPY.toLocaleString()} <span style={{ color: "#aaa", fontSize: 12 }}>（1{currency} = ¥{Math.round(rates[currency] || 0).toLocaleString()}）</span></>
          ) : (
            <span style={{ color: "#aaa" }}>レート取得中...</span>
          )}
        </div>
      )}

      {/* 支払った人 */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, color: "#bbb", fontWeight: 700, letterSpacing: 1, marginBottom: 11 }}>支払った人</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {members.map(m => (
            <button key={m.id} onClick={() => setPaidBy(m.id)} style={{ border: `2px solid ${paidBy === m.id ? m.color : "#eee"}`, borderRadius: 12, padding: "7px 13px", cursor: "pointer", background: paidBy === m.id ? m.color + "22" : "#fff", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "#333" }}>
              <Avatar name={m.name} color={m.color} size={20} />{m.name}
            </button>
          ))}
        </div>
      </div>

      {/* 割り勘メンバー */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, color: "#bbb", fontWeight: 700, letterSpacing: 1, marginBottom: 11 }}>
          割り勘メンバー <span style={{ fontWeight: 400, fontSize: 11 }}>（未選択 = 全員）</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {members.map(m => {
            const sel = participants.includes(m.id);
            return (
              <button key={m.id} onClick={() => toggle(m.id)} style={{ border: `2px solid ${sel ? m.color : "#eee"}`, borderRadius: 12, padding: "7px 13px", cursor: "pointer", background: sel ? m.color + "22" : "#fff", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "#333" }}>
                <Avatar name={m.name} color={m.color} size={20} />{m.name}{sel && <Icon name="check" size={12} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 1人あたりプレビュー */}
      {canSave && (
        <div style={{ marginTop: 16, padding: "10px 14px", background: "#f8f7ff", borderRadius: 12, fontSize: 13, color: "#666", textAlign: "center" }}>
          1人あたり ¥{Math.round(amountJPY / Math.max(participants.length || group?.members?.length || 1, 1)).toLocaleString()}
        </div>
      )}

      <PrimaryBtn onClick={handleSave} disabled={!canSave || saving} style={{ width: "100%", marginTop: 20 }}>
        {saving ? "保存中..." : initialData ? "更新する" : "追加する"}
      </PrimaryBtn>
    </Modal>
  );
}

// ─── ルーティング ──────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TopScreen />} />
      <Route path="/group/:groupId" element={<GroupScreen />} />
    </Routes>
  );
}
